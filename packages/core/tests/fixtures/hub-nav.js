(() => {
  if (navigator.webdriver || window !== window.top) return;

  const path = location.pathname.replace(/\/+$/, '') || '/';
  const file = new URLSearchParams(location.search).get('file');
  const links = [
    { href: '/', label: 'Home', id: 'nav-home', current: path === '' || path === '/' },
    { href: '/app/login.html', label: 'Login', id: 'nav-login', current: path.endsWith('/login.html') },
    { href: '/app/customer.html', label: 'Customer', id: 'nav-customer', current: path.endsWith('/customer.html') },
    { href: '/app/screens.html', label: 'Screens', id: 'nav-screens', current: path.endsWith('/screens.html') },
    { href: '/app/config.html', label: 'Config', id: 'nav-config', current: path.endsWith('/config.html') && file !== 'test' },
    { href: '/app/config.html?file=test', label: 'Test', id: 'nav-test', current: path.endsWith('/config.html') && file === 'test' },
  ];

  const nav = document.createElement('nav');
  nav.className = 'hub-nav nav';
  nav.innerHTML = links.map((link) => (
    `<a href="${link.href}" id="${link.id}"${link.current ? ' class="current"' : ''}>${link.label}</a>`
  )).join('');

  const existing = document.querySelector('.titlebar .nav');
  if (existing) {
    existing.replaceWith(nav);
    return;
  }

  const bar = document.createElement('div');
  bar.className = 'hub-nav-bar';
  bar.appendChild(nav);
  document.body.classList.add('has-hub-nav');
  document.body.prepend(bar);
})();
