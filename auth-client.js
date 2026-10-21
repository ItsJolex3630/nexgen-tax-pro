/* =====================================================================
   NEXGEN TAX PRO · AUTH CLIENT
   Portal de Clientes: sesión, login, registro, OTP, recuperación y cuenta.
   ===================================================================== */
(function () {
  "use strict";

  var API = "/api/auth";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var session = null;
  var view = "login";
  var pendingEmail = "";
  var otpMode = "verify";
  var cooldownTimer = null;
  var cooldownLeft = 0;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function firstName(name) {
    var n = String(name || "").trim().split(/\s+/)[0];
    return n || "Mi cuenta";
  }

  /* ---------------- API ---------------- */
  async function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || "GET", credentials: "include", headers: { accept: "application/json" } };
    if (opts.body) {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    try {
      var res = await fetch(API + path, init);
      var data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      return { ok: res.ok, status: res.status, data: data };
    } catch (e) {
      return { ok: false, status: 0, data: { message: "No pudimos conectar con el servidor. Revisa tu conexión." } };
    }
  }

  var ERROR_MAP = {
    INVALID_EMAIL_OR_PASSWORD: "Correo o contraseña incorrectos.",
    EMAIL_NOT_VERIFIED: "Debes verificar tu correo antes de iniciar sesión.",
    USER_ALREADY_EXISTS: "Ya existe una cuenta con este correo.",
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Ya existe una cuenta con este correo.",
    PASSWORD_TOO_SHORT: "La contraseña debe tener al menos 8 caracteres.",
    PASSWORD_TOO_LONG: "La contraseña es demasiado larga.",
    INVALID_EMAIL: "El correo electrónico no es válido.",
    INVALID_PASSWORD: "La contraseña es incorrecta.",
    INVALID_OTP: "El código es incorrecto. Revisa e intenta de nuevo.",
    OTP_EXPIRED: "El código expiró. Solicita uno nuevo.",
    TOO_MANY_ATTEMPTS: "Demasiados intentos. Espera un momento y vuelve a intentarlo.",
    FAILED_TO_SEND_OTP: "No pudimos enviar el correo. Intenta de nuevo en unos segundos.",
    EMAIL_SEND_FAILED: "No pudimos enviar el correo. Intenta de nuevo en unos segundos.",
    SESSION_EXPIRED: "Tu sesión expiró. Inicia sesión de nuevo."
  };

  function errText(res) {
    var d = res && res.data ? res.data : {};
    var code = d.code || (d.error && d.error.code) || "";
    if (ERROR_MAP[code]) return ERROR_MAP[code];
    var msg = d.message || (d.error && d.error.message) || "";
    if (/email.*(verif|confirm)/i.test(msg)) return "Debes verificar tu correo antes de continuar.";
    if (/invalid.*(otp|code)/i.test(msg)) return ERROR_MAP.INVALID_OTP;
    if (/expired/i.test(msg)) return ERROR_MAP.OTP_EXPIRED;
    if (/too many/i.test(msg)) return ERROR_MAP.TOO_MANY_ATTEMPTS;
    if (/password/i.test(msg) && /short|least|minimum/i.test(msg)) return ERROR_MAP.PASSWORD_TOO_SHORT;
    if (/already exists|already registered/i.test(msg)) return ERROR_MAP.USER_ALREADY_EXISTS;
    if (/invalid email or password/i.test(msg)) return ERROR_MAP.INVALID_EMAIL_OR_PASSWORD;
    return msg || "Ocurrió un error inesperado. Intenta de nuevo.";
  }

  function msg(text, kind) {
    var box = $("#auth-msg");
    if (!box) return;
    box.textContent = text || "";
    box.className = "auth-msg" + (text ? " " + (kind || "error") : "");
  }

  function busy(btn, on, label) {
    if (!btn) return;
    if (on) {
      btn.dataset.label = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="auth-spin" aria-hidden="true"></span>' + (label || "Procesando…");
    } else {
      btn.disabled = false;
      if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
    }
  }

  /* ---------------- session ---------------- */
  async function refreshSession() {
    var r = await api("/get-session");
    session = r.ok && r.data && r.data.user ? r.data : null;
    updateChrome();
    return session;
  }

  function updateChrome() {
    var label = session ? firstName(session.user.name) : "Portal Clientes";
    $$("[data-auth-label]").forEach(function (el) { el.textContent = label; });
    var btn = $("#auth-btn");
    if (btn) btn.classList.toggle("auth-active", !!session);
    var ic = $("#auth-ic");
    if (ic) ic.textContent = session ? "✓" : "👤";
    $$("[data-auth-open]").forEach(function (b) {
      b.setAttribute("aria-label", session ? "Mi cuenta · " + session.user.email : "Portal de Clientes");
    });
  }

  /* ---------------- views ---------------- */
  function loginHTML() {
    return '<form class="auth-form" data-form="login" novalidate>' +
      '<label class="auth-lbl">Correo electrónico<input class="auth-in" type="email" name="email" required autocomplete="email" placeholder="tu@correo.com"></label>' +
      '<label class="auth-lbl">Contraseña<input class="auth-in" type="password" name="password" required minlength="8" autocomplete="current-password" placeholder="Mínimo 8 caracteres"></label>' +
      '<button class="auth-submit" type="submit">Entrar a mi cuenta</button>' +
      '<div class="auth-links"><button type="button" class="auth-link" data-go="forgot">¿Olvidaste tu contraseña?</button></div>' +
      "</form>";
  }

  function signupHTML() {
    return '<form class="auth-form" data-form="signup" novalidate>' +
      '<label class="auth-lbl">Nombre completo<input class="auth-in" type="text" name="name" required autocomplete="name" placeholder="Tu nombre y apellido"></label>' +
      '<label class="auth-lbl">Correo electrónico<input class="auth-in" type="email" name="email" required autocomplete="email" placeholder="tu@correo.com"></label>' +
      '<div class="auth-row2">' +
      '<label class="auth-lbl">Teléfono<input class="auth-in" type="tel" name="phone" autocomplete="tel" placeholder="(407) 000-0000"></label>' +
      '<label class="auth-lbl">Oficina (opcional)<input class="auth-in" type="text" name="officeName" autocomplete="organization" placeholder="Nombre de tu oficina"></label>' +
      "</div>" +
      '<label class="auth-lbl">Contraseña<input class="auth-in" type="password" name="password" required minlength="8" autocomplete="new-password" placeholder="Mínimo 8 caracteres"></label>' +
      '<p class="auth-fine">Al crear tu cuenta aceptas los Términos de Uso y la Política de Privacidad.</p>' +
      '<button class="auth-submit" type="submit">Crear mi cuenta</button>' +
      "</form>";
  }

  function otpHTML() {
    var boxes = "";
    for (var i = 0; i < 6; i++) {
      boxes += '<input class="auth-otp" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" autocomplete="' + (i === 0 ? "one-time-code" : "off") + '" aria-label="Dígito ' + (i + 1) + '">';
    }
    var reset = otpMode === "reset";
    return '<form class="auth-form" data-form="otp" novalidate>' +
      '<p class="auth-sub">' + (reset ? "Enviamos un código para restablecer tu contraseña a" : "Enviamos un código de 6 dígitos a") + " <b>" + esc(pendingEmail) + "</b>.</p>" +
      '<div class="auth-otp-row">' + boxes + "</div>" +
      (reset ? '<label class="auth-lbl">Nueva contraseña<input class="auth-in" type="password" name="newPassword" required minlength="8" autocomplete="new-password" placeholder="Mínimo 8 caracteres"></label>' : "") +
      '<p class="auth-resend"><button type="button" class="auth-link" data-resend>Reenviar código</button><span class="auth-cd" id="auth-cd"></span></p>' +
      '<button class="auth-submit" type="submit">' + (reset ? "Restablecer contraseña" : "Verificar código") + "</button>" +
      '<div class="auth-links"><button type="button" class="auth-link" data-go="login">← Volver a iniciar sesión</button></div>' +
      "</form>";
  }

  function forgotHTML() {
    return '<form class="auth-form" data-form="forgot" novalidate>' +
      '<p class="auth-sub">Escribe tu correo y te enviaremos un código para restablecer tu contraseña.</p>' +
      '<label class="auth-lbl">Correo electrónico<input class="auth-in" type="email" name="email" required autocomplete="email" placeholder="tu@correo.com"></label>' +
      '<button class="auth-submit" type="submit">Enviar código de recuperación</button>' +
      '<div class="auth-links"><button type="button" class="auth-link" data-go="login">← Volver a iniciar sesión</button></div>' +
      "</form>";
  }

  function accountHTML() {
    var u = session.user;
    var role = u.role === "admin" ? "Administrador" : u.role === "office_admin" ? "Admin de Oficina" : "Preparador Registrado";
    var initial = String(u.name || u.email || "N").trim().charAt(0).toUpperCase();
    var rows = '<div class="auth-row"><span>Correo</span><b>' + esc(u.email) + "</b></div>";
    if (u.phone) rows += '<div class="auth-row"><span>Teléfono</span><b>' + esc(u.phone) + "</b></div>";
    if (u.officeName) rows += '<div class="auth-row"><span>Oficina</span><b>' + esc(u.officeName) + "</b></div>";
    if (u.ptin) rows += '<div class="auth-row"><span>PTIN</span><b>' + esc(u.ptin) + "</b></div>";
    return '<div class="auth-account">' +
      '<div class="auth-avatar" aria-hidden="true">' + esc(initial) + "</div>" +
      "<h4>" + esc(u.name || "Mi cuenta") + "</h4>" +
      '<span class="auth-role">' + role + "</span>" +
      '<div class="auth-rows">' + rows + "</div>" +
      '<button type="button" class="auth-submit auth-logout" data-logout>Cerrar Sesión</button>' +
      "</div>";
  }

  function render() {
    var body = $("#auth-body");
    if (!body) return;
    msg("");
    var tabs = $("#auth-tabs");
    if (tabs) tabs.hidden = view !== "login" && view !== "signup";
    $$("[data-auth-tab]").forEach(function (b) {
      var on = b.getAttribute("data-auth-tab") === view;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.classList.toggle("on", on);
    });

    if (view === "account" && session) body.innerHTML = accountHTML();
    else if (view === "signup") body.innerHTML = signupHTML();
    else if (view === "otp") body.innerHTML = otpHTML();
    else if (view === "forgot") body.innerHTML = forgotHTML();
    else body.innerHTML = loginHTML();

    bindView(body);
    var first = $(".auth-in, .auth-otp", body);
    if (first) setTimeout(function () { first.focus(); }, 60);
  }

  function bindView(body) {
    $$("[data-go]", body).forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.dataset.go === "login") { otpMode = "verify"; pendingEmail = ""; }
        view = b.dataset.go;
        render();
      });
    });

    var form = $("[data-form]", body);
    if (!form) return;

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var btn = $(".auth-submit", form);
      var name = form.dataset.form;

      if (name === "login") {
        var email = (form.elements.namedItem("email") || {}).value;
        var pass = (form.elements.namedItem("password") || {}).value;
        email = String(email || "").trim();
        if (!email || !pass) return msg("Completa tu correo y contraseña.", "error");
        busy(btn, true, "Entrando…");
        var r = await api("/sign-in/email", { method: "POST", body: { email: email, password: pass } });
        if (r.ok) {
          await refreshSession();
          if (session) { view = "account"; render(); }
          else { view = "login"; render(); msg("Sesión iniciada. Recargando…", "ok"); setTimeout(function () { location.reload(); }, 800); }
          return;
        }
        busy(btn, false);
        var code = (r.data && r.data.code) || "";
        if (code === "EMAIL_NOT_VERIFIED" || /verif/i.test(errText(r))) {
          var sent = await sendOtp(email, "email-verification");
          switchOtp(email, "verify", sent);
          if (!sent) msg("Tu correo requiere verificación. Pulsa «Reenviar código».", "error");
          return;
        }
        msg(errText(r), "error");
        return;
      }

      if (name === "signup") {
        var el = function (n) { return form.elements.namedItem(n); };
        var data = {
          name: String((el("name") || {}).value || "").trim(),
          email: String((el("email") || {}).value || "").trim(),
          password: String((el("password") || {}).value || ""),
          phone: String((el("phone") || {}).value || "").trim() || undefined,
          officeName: String((el("officeName") || {}).value || "").trim() || undefined
        };
        if (!data.name) return msg("Escribe tu nombre completo.", "error");
        if (!data.email) return msg("Escribe tu correo electrónico.", "error");
        if (data.password.length < 8) return msg("La contraseña debe tener al menos 8 caracteres.", "error");
        busy(btn, true, "Creando cuenta…");
        var sr = await api("/sign-up/email", { method: "POST", body: data });
        if (!sr.ok) { busy(btn, false); return msg(errText(sr), "error"); }
        switchOtp(data.email, "verify", false);
        msg("Cuenta creada. Revisa tu correo e ingresa el código de 6 dígitos.", "ok");
        return;
      }

      if (name === "forgot") {
        var fe = String((form.elements.namedItem("email") || {}).value || "").trim();
        if (!fe) return msg("Escribe tu correo electrónico.", "error");
        busy(btn, true, "Enviando…");
        var fr = await api("/email-otp/request-password-reset", { method: "POST", body: { email: fe } });
        busy(btn, false);
        if (!fr.ok) return msg(errText(fr), "error");
        switchOtp(fe, "reset", true);
        msg("Si el correo está registrado, recibirás un código de recuperación.", "ok");
        return;
      }

      if (name === "otp") {
        var codeInputs = $$(".auth-otp", form);
        var otp = codeInputs.map(function (i) { return i.value; }).join("");
        if (otp.length !== 6) return msg("Ingresa los 6 dígitos del código.", "error");
        busy(btn, true, otpMode === "reset" ? "Restableciendo…" : "Verificando…");
        if (otpMode === "reset") {
          var np = String((form.elements.namedItem("newPassword") || {}).value || "");
          if (np.length < 8) { busy(btn, false); return msg("La nueva contraseña debe tener al menos 8 caracteres.", "error"); }
          var rr = await api("/email-otp/reset-password", { method: "POST", body: { email: pendingEmail, otp: otp, password: np } });
          busy(btn, false);
          if (!rr.ok) return msg(errText(rr), "error");
          otpMode = "verify"; pendingEmail = ""; view = "login"; render();
          return msg("Contraseña actualizada. Inicia sesión con tu nueva contraseña.", "ok");
        }
        var vr = await api("/email-otp/verify-email", { method: "POST", body: { email: pendingEmail, otp: otp } });
        busy(btn, false);
        if (!vr.ok) return msg(errText(vr), "error");
        await refreshSession();
        if (session) { view = "account"; render(); msg("¡Correo verificado! Bienvenido a NexGen Tax Pro.", "ok"); }
        else { view = "login"; render(); msg("Correo verificado. Ya puedes iniciar sesión.", "ok"); }
        return;
      }
    });

    var boxes = $$(".auth-otp", form);
    boxes.forEach(function (box, idx) {
      box.addEventListener("input", function () {
        box.value = box.value.replace(/\D/g, "").slice(-1);
        if (box.value && idx < boxes.length - 1) boxes[idx + 1].focus();
      });
      box.addEventListener("keydown", function (e) {
        if (e.key === "Backspace" && !box.value && idx > 0) boxes[idx - 1].focus();
        if (e.key === "ArrowLeft" && idx > 0) boxes[idx - 1].focus();
        if (e.key === "ArrowRight" && idx < boxes.length - 1) boxes[idx + 1].focus();
      });
    });
    if (boxes.length) {
      form.addEventListener("paste", function (e) {
        var txt = (e.clipboardData || window.clipboardData).getData("text") || "";
        var digits = txt.replace(/\D/g, "").slice(0, 6);
        if (!digits) return;
        e.preventDefault();
        digits.split("").forEach(function (d, i) { if (boxes[i]) boxes[i].value = d; });
        if (boxes[Math.min(digits.length, 6) - 1]) boxes[Math.min(digits.length, 6) - 1].focus();
      });
    }

    var resend = $("[data-resend]", form);
    if (resend) {
      resend.addEventListener("click", async function () {
        if (resend.disabled) return;
        resend.disabled = true;
        var ok = await sendOtp(pendingEmail, otpMode === "reset" ? "forget-password" : "email-verification");
        if (ok) { startCooldown(60); msg("Código reenviado. Revisa tu correo.", "ok"); }
        else { resend.disabled = false; msg("No pudimos reenviar el código. Intenta de nuevo.", "error"); }
      });
      if (cooldownLeft > 0) startCooldown(cooldownLeft);
    }

    var logout = $("[data-logout]", body);
    if (logout) {
      logout.addEventListener("click", async function () {
        busy(logout, true, "Saliendo…");
        await api("/sign-out", { method: "POST" });
        session = null;
        updateChrome();
        view = "login";
        render();
      });
    }
  }

  function switchOtp(email, mode, sent) {
    pendingEmail = email;
    otpMode = mode;
    view = "otp";
    cooldownLeft = sent ? 60 : 0;
    render();
    if (sent) startCooldown(60);
  }

  async function sendOtp(email, type) {
    if (!email) return false;
    var r = await api("/email-otp/send-verification-otp", { method: "POST", body: { email: email, type: type } });
    return r.ok;
  }

  function startCooldown(sec) {
    var btn = $("[data-resend]");
    var cd = $("#auth-cd");
    if (cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null; }
    cooldownLeft = sec;
    function tick() {
      var b = $("[data-resend]");
      var label = $("#auth-cd");
      if (!b) { if (cooldownTimer) clearInterval(cooldownTimer); cooldownTimer = null; return; }
      if (cooldownLeft <= 0) {
        b.disabled = false;
        b.textContent = "Reenviar código";
        if (label) label.textContent = "";
        clearInterval(cooldownTimer);
        cooldownTimer = null;
        return;
      }
      b.disabled = true;
      b.textContent = "Reenviar en " + cooldownLeft + "s";
      if (label) label.textContent = "";
      cooldownLeft--;
    }
    tick();
    cooldownTimer = setInterval(tick, 1000);
  }

  /* ---------------- modal ---------------- */
  function openAuth() {
    var ov = $("#auth-ov");
    if (!ov) return;
    var mnav = $("#mnav");
    if (mnav && mnav.classList.contains("on")) { var mc = $("#mclose"); if (mc) mc.click(); }
    ov.hidden = false;
    document.body.style.overflow = "hidden";
    view = session ? "account" : "login";
    render();
    setTimeout(function () { var f = $("#auth-body .auth-in, #auth-body .auth-otp"); if (f) f.focus(); }, 80);
  }

  function closeAuth() {
    var ov = $("#auth-ov");
    if (!ov) return;
    ov.hidden = true;
    document.body.style.overflow = "";
    msg("");
    if (cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null; cooldownLeft = 0; }
  }

  /* ---------------- init ---------------- */
  function init() {
    $$("[data-auth-open]").forEach(function (b) {
      b.addEventListener("click", function (e) { e.preventDefault(); openAuth(); });
    });
    $$("[data-auth-tab]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (session) return;
        view = b.getAttribute("data-auth-tab") === "signup" ? "signup" : "login";
        render();
      });
    });
    var close = $("#auth-close");
    if (close) close.addEventListener("click", closeAuth);
    var ov = $("#auth-ov");
    if (ov) ov.addEventListener("click", function (e) { if (e.target === ov) closeAuth(); });
    document.addEventListener("keydown", function (e) {
      var o = $("#auth-ov");
      if (e.key === "Escape" && o && !o.hidden) closeAuth();
    });
    refreshSession();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
