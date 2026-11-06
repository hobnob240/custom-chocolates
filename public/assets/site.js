// Small progressive enhancements. Every page works without this file.
(function () {
  'use strict';
  // focus the error summary so screen readers announce it
  var err = document.getElementById('form-errors');
  if (err) { err.focus(); err.scrollIntoView({ block: 'center' }); }
  // stop double submits
  document.querySelectorAll('form[data-enhance]').forEach(function (f) {
    f.addEventListener('submit', function () {
      var b = f.querySelector('button[type="submit"]');
      if (b) { setTimeout(function () { b.disabled = true; b.setAttribute('aria-busy', 'true'); }, 0); setTimeout(function () { b.disabled = false; b.removeAttribute('aria-busy'); }, 8000); }
    });
  });
  // checkout: only ask for an address when it is needed
  var addr = document.querySelector('[data-address]');
  if (addr) {
    var sync = function () {
      var c = document.querySelector('input[name="fulfilment"]:checked');
      var need = c && c.value !== 'collect';
      addr.hidden = !need;
      addr.querySelectorAll('input').forEach(function (i) { if (i.name !== 'address2') i.required = !!need; });
    };
    document.querySelectorAll('input[name="fulfilment"]').forEach(function (r) { r.addEventListener('change', sync); });
    sync();
  }
  // close the phone menu after choosing a link
  document.querySelectorAll('.menu__panel a').forEach(function (a) { a.addEventListener('click', function () { var d = a.closest('details'); if (d) d.open = false; }); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { var d = document.querySelector('.menu[open]'); if (d) { d.open = false; d.querySelector('summary').focus(); } } });
})();
