/* AZAM REKA — main.js (static catalog site) */

document.addEventListener('DOMContentLoaded', () => {
  const header = document.querySelector('.site-header');
  if (header) {
    const setScrolled = () => {
      header.dataset.scrolled = window.scrollY > 8 ? 'true' : 'false';
    };
    setScrolled();
    window.addEventListener('scroll', setScrolled, { passive: true });
  }

  const mobileToggle = document.querySelector('[data-mobile-nav-toggle]');
  const mobileNav = document.querySelector('[data-mobile-nav]');
  if (mobileToggle && mobileNav) {
    mobileToggle.addEventListener('click', () => {
      const isOpen = mobileNav.dataset.open === 'true';
      mobileNav.dataset.open = isOpen ? 'false' : 'true';
      mobileNav.style.display = isOpen ? 'none' : 'flex';
      mobileToggle.setAttribute('aria-expanded', String(!isOpen));
    });
  }

  // Scroll-reveal
  const targets = document.querySelectorAll('[data-reveal]');
  if (targets.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.dataset.reveal = 'visible';
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    targets.forEach((el) => observer.observe(el));
  }
});
