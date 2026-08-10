/* AZAM REKA — main.js (static catalog site with cart) */

// ============ CART MANAGEMENT ============
const Cart = {
  getCart() {
    return JSON.parse(localStorage.getItem('azamReka_cart') || '[]');
  },
  saveCart(cart) {
    localStorage.setItem('azamReka_cart', JSON.stringify(cart));
    this.updateCartCount();
  },
  addItem(name, price, note = '') {
    const cart = this.getCart();
    const existing = cart.find(item => item.name === name && item.note === note);
    if (existing) {
      existing.qty += 1;
    } else {
      cart.push({ name, price, qty: 1, note });
    }
    this.saveCart(cart);
  },
  removeItem(name) {
    let cart = this.getCart();
    cart = cart.filter(item => item.name !== name);
    this.saveCart(cart);
  },
  updateQty(name, qty) {
    const cart = this.getCart();
    const item = cart.find(item => item.name === name);
    if (item) item.qty = Math.max(1, qty);
    this.saveCart(cart);
  },
  clear() {
    localStorage.removeItem('azamReka_cart');
    this.updateCartCount();
  },
  updateCartCount() {
    const cart = this.getCart();
    const count = cart.reduce((sum, item) => sum + item.qty, 0);
    const badge = document.querySelector('[data-cart-count]');
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'inline-flex' : 'none';
    }
  },
  getTotal() {
    const cart = this.getCart();
    return cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  },
  generateWhatsAppMessage() {
    const cart = this.getCart();
    if (cart.length === 0) return '';
    const items = cart.map(item => {
      let line = `• ${item.name} (RM ${item.price.toFixed(2)}) x${item.qty}`;
      if (item.note) line += `\n  ↳ ${item.note}`;
      return line;
    }).join('\n');
    const total = this.getTotal();
    return `Hi Azam Reka, I'd like to order:\n\n${items}\n\nTotal: RM ${total.toFixed(2)}`;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  Cart.updateCartCount();

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

  // Cart modal
  const cartBtn = document.querySelector('[data-cart-btn]');
  const cartModal = document.querySelector('[data-cart-modal]');
  const cartClose = document.querySelector('[data-cart-close]');
  
  if (cartBtn && cartModal) {
    cartBtn.addEventListener('click', () => {
      cartModal.dataset.open = 'true';
      cartModal.style.display = 'flex';
      renderCart();
    });
  }
  if (cartClose && cartModal) {
    cartClose.addEventListener('click', () => {
      cartModal.dataset.open = 'false';
      cartModal.style.display = 'none';
    });
  }
  if (cartModal) {
    cartModal.addEventListener('click', (e) => {
      if (e.target === cartModal) {
        cartModal.dataset.open = 'false';
        cartModal.style.display = 'none';
      }
    });
  }

  // Add to cart buttons
  document.querySelectorAll('[data-add-to-cart]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const name = btn.dataset.addToCart;
      const price = parseFloat(btn.dataset.price);
      Cart.addItem(name, price);
      alert(`${name} added to cart!`);
    });
  });

  function renderCart() {
    const cartItems = document.querySelector('[data-cart-items]');
    const cartEmpty = document.querySelector('[data-cart-empty]');
    const cartCheckout = document.querySelector('[data-cart-checkout]');
    const cart = Cart.getCart();

    if (!cartItems) return;

    if (cart.length === 0) {
      cartItems.style.display = 'none';
      if (cartEmpty) cartEmpty.style.display = 'block';
      if (cartCheckout) cartCheckout.style.display = 'none';
      return;
    }

    cartItems.style.display = 'block';
    if (cartEmpty) cartEmpty.style.display = 'none';
    if (cartCheckout) cartCheckout.style.display = 'flex';

    cartItems.innerHTML = cart.map(item => `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; padding: 1rem 0; border-bottom: 1px solid var(--color-ash);">
        <div style="flex:1; min-width:0;">
          <p style="margin:0; font-weight:600;">${item.name} x${item.qty}</p>
          ${item.note ? `<p style="margin:0.2em 0 0; font-size:0.78rem; color:var(--color-structural); font-family:var(--font-mono);">${item.note}</p>` : ''}
          <p style="margin:0; color: var(--color-structural); font-size:0.9rem;">RM ${item.price.toFixed(2)}</p>
        </div>
        <div style="display:flex; align-items:center; gap: 0.5rem; flex-shrink:0; margin-left:0.5rem;">
          <button data-qty-minus="${item.name}" style="width:32px; height:32px; border:1px solid var(--color-ash); background:none; cursor:pointer;">−</button>
          <span style="width:32px; text-align:center;">${item.qty}</span>
          <button data-qty-plus="${item.name}" style="width:32px; height:32px; border:1px solid var(--color-ash); background:none; cursor:pointer;">+</button>
          <button data-remove="${item.name}" style="width:32px; height:32px; border:1px solid var(--color-ash); background:none; cursor:pointer; color:var(--color-ember);">×</button>
        </div>
      </div>
    `).join('');

    // Quantity controls
    document.querySelectorAll('[data-qty-plus]').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.qtyPlus;
        const cart = Cart.getCart();
        const item = cart.find(i => i.name === name);
        if (item) Cart.updateQty(name, item.qty + 1);
        renderCart();
      });
    });
    document.querySelectorAll('[data-qty-minus]').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.qtyMinus;
        const cart = Cart.getCart();
        const item = cart.find(i => i.name === name);
        if (item && item.qty > 1) Cart.updateQty(name, item.qty - 1);
        renderCart();
      });
    });
    document.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        Cart.removeItem(btn.dataset.remove);
        renderCart();
      });
    });

    // Update total
    const total = Cart.getTotal();
    const totalEl = document.querySelector('[data-cart-total]');
    if (totalEl) totalEl.textContent = `RM ${total.toFixed(2)}`;
  }

  // Checkout via payment form
  const checkoutBtn = document.querySelector('[data-cart-whatsapp]');
  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', () => {
      const cart = Cart.getCart();
      if (cart.length > 0) {
        window.location.href = '/checkout.html';
      }
    });
  }

  // Promo bar — auto-rotating announcement carousel
  const promoTrack = document.querySelector('.promo-track');
  if (promoTrack) {
    const slides = promoTrack.querySelectorAll('.promo-slide');
    if (slides.length > 1) {
      let promoIndex = 0;
      let promoTimer;

      function showPromo(index) {
        const current = slides[promoIndex];
        current.classList.remove('is-active');
        current.classList.add('is-leaving');
        setTimeout(() => current.classList.remove('is-leaving'), 400);

        promoIndex = (index + slides.length) % slides.length;
        slides[promoIndex].classList.add('is-active');
      }

      function startPromoTimer() {
        clearInterval(promoTimer);
        promoTimer = setInterval(() => showPromo(promoIndex + 1), 4500);
      }

      document.querySelectorAll('.promo-arrow--prev').forEach(btn => {
        btn.addEventListener('click', () => { showPromo(promoIndex - 1); startPromoTimer(); });
      });
      document.querySelectorAll('.promo-arrow--next').forEach(btn => {
        btn.addEventListener('click', () => { showPromo(promoIndex + 1); startPromoTimer(); });
      });

      startPromoTimer();
    }
  }

  // Product image/video carousels
  document.querySelectorAll('.product-card__media[data-carousel]').forEach(media => {
    const slides = media.querySelectorAll('.carousel-slide');
    const dots = media.querySelectorAll('.carousel-dot');
    if (slides.length <= 1) return;

    let current = 0;

    function pauseAllVideos() {
      slides.forEach(s => {
        const video = s.querySelector('video');
        if (video) {
          video.pause();
          video.currentTime = 0;
        }
      });
    }

    function playCurrentVideo() {
      const video = slides[current].querySelector('video');
      if (video) {
        video.play().catch(() => {}); // ignore autoplay rejection
      }
    }

    function showSlide(index) {
      pauseAllVideos();
      slides.forEach(s => s.classList.remove('is-active'));
      dots.forEach(d => d.classList.remove('is-active'));
      current = (index + slides.length) % slides.length;
      slides[current].classList.add('is-active');
      if (dots[current]) dots[current].classList.add('is-active');
      playCurrentVideo();
    }

    const prevBtn = media.querySelector('.carousel-arrow--prev');
    const nextBtn = media.querySelector('.carousel-arrow--next');

    if (prevBtn) prevBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showSlide(current - 1);
    });
    if (nextBtn) nextBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showSlide(current + 1);
    });
    dots.forEach((dot, i) => {
      dot.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showSlide(i);
      });
    });

    // Swipe support — the primary way phone users will browse multi-photo
    // products, since hover-only arrows don't exist on touch devices.
    let touchStartX = 0;
    let touchEndX = 0;
    const track = media.querySelector('.carousel-track');
    if (track) {
      track.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
      }, { passive: true });
      track.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        const delta = touchEndX - touchStartX;
        const SWIPE_THRESHOLD = 40;
        if (Math.abs(delta) > SWIPE_THRESHOLD) {
          if (delta < 0) {
            showSlide(current + 1); // swiped left → next
          } else {
            showSlide(current - 1); // swiped right → previous
          }
        }
      }, { passive: true });
    }

    // Autoplay the first video if it's the initial active slide
    playCurrentVideo();
  });

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
