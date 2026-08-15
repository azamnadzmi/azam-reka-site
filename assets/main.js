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
  addItem(name, price, qty = 1) {
    const cart = this.getCart();
    const existing = cart.find(item => item.name === name);
    if (existing) {
      existing.qty += qty;
    } else {
      cart.push({ name, price, qty });
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
    const items = cart.map(item => `• ${item.name} (RM ${item.price.toFixed(2)}) x${item.qty}`).join('\n');
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

  // Cart drawer
  const cartBtn = document.querySelector('[data-cart-btn]');
  const cartModal = document.querySelector('[data-cart-modal]');
  const cartClose = document.querySelector('[data-cart-close]');
  const cartContinue = document.querySelector('[data-cart-continue]');

  function openCart() {
    if (!cartModal) return;
    cartModal.style.display = 'block';
    // Force a reflow so the transform transition actually plays instead of
    // jumping straight to open (display:none -> block then dataset in the
    // same tick would otherwise skip the transition).
    void cartModal.offsetHeight;
    cartModal.dataset.open = 'true';
    renderCart();
  }
  function closeCart() {
    if (!cartModal) return;
    cartModal.dataset.open = 'false';
    setTimeout(() => { cartModal.style.display = 'none'; }, 320);
  }

  if (cartBtn && cartModal) {
    cartBtn.addEventListener('click', openCart);
  }
  if (cartClose && cartModal) {
    cartClose.addEventListener('click', closeCart);
  }
  if (cartContinue && cartModal) {
    cartContinue.addEventListener('click', closeCart);
  }
  if (cartModal) {
    cartModal.addEventListener('click', (e) => {
      if (e.target === cartModal) closeCart();
    });
  }

  // Variant pickers — point the sibling add-to-cart/buy-now buttons at the chosen variant
  document.querySelectorAll('[data-variant-picker]').forEach(select => {
    const btn = select.parentElement.querySelector('[data-add-to-cart]');
    const buyBtn = select.parentElement.querySelector('[data-buy-now]');
    if (!btn) return;
    const sync = () => {
      const opt = select.selectedOptions[0];
      if (!opt) return;
      btn.dataset.addToCart = opt.value;
      btn.dataset.price = opt.dataset.price;
      if (buyBtn) {
        buyBtn.dataset.buyNow = opt.value;
        buyBtn.dataset.price = opt.dataset.price;
      }
    };
    // Browsers restore a select's value on refresh/back-navigation without firing
    // change, so sync once up front or the button could disagree with what's shown.
    sync();
    select.addEventListener('change', sync);
  });

  // Quantity steppers on product detail pages
  document.querySelectorAll('[data-qty-stepper]').forEach(stepper => {
    const valueEl = stepper.querySelector('[data-qty-stepper-value]');
    const minusBtn = stepper.querySelector('[data-qty-stepper-minus]');
    const plusBtn = stepper.querySelector('[data-qty-stepper-plus]');
    if (!valueEl) return;
    minusBtn.addEventListener('click', () => {
      const current = parseInt(valueEl.textContent, 10) || 1;
      valueEl.textContent = Math.max(1, current - 1);
    });
    plusBtn.addEventListener('click', () => {
      const current = parseInt(valueEl.textContent, 10) || 1;
      valueEl.textContent = current + 1;
    });
  });

  // Reads the quantity from a nearby stepper, if one exists on the page —
  // catalogue/home cards have no stepper and always add 1 at a time.
  function stepperQty(nearEl) {
    const stepper = nearEl.parentElement.querySelector('[data-qty-stepper-value]');
    return stepper ? (parseInt(stepper.textContent, 10) || 1) : 1;
  }

  // Add to cart buttons — with visual feedback
  document.querySelectorAll('[data-add-to-cart]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      // On catalogue cards the picker starts hidden — reveal it and let them
      // choose before anything lands in the cart.
      const picker = btn.parentElement.querySelector('[data-variant-picker]');
      if (picker && picker.hidden) {
        picker.hidden = false;
        picker.focus();
        return;
      }
      const name = btn.dataset.addToCart;
      const price = parseFloat(btn.dataset.price);
      Cart.addItem(name, price, stepperQty(btn));

      // Visual feedback: pulse cart count badge
      const cartCount = document.querySelector('[data-cart-count]');
      if (cartCount) {
        cartCount.classList.remove('pulse');
        // Trigger reflow to restart animation
        void cartCount.offsetWidth;
        cartCount.classList.add('pulse');
      }

      // Show brief toast notification
      showCartToast(`${name} added to cart!`);
    });
  });

  // Toast notification for cart feedback
  function showCartToast(message) {
    const existing = document.querySelector('[data-cart-toast]');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.dataset.cartToast = '';
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--color-char);
      color: var(--color-bone);
      padding: 1rem 1.5rem;
      border-radius: 0;
      font-family: var(--font-mono);
      font-size: 0.9rem;
      z-index: 200;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      animation: slideUp 0.3s var(--ease-precise);
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Remove after 2 seconds with fade out
    setTimeout(() => {
      toast.style.animation = 'slideDown 0.3s var(--ease-precise) forwards';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  // Add toast animations to styles
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideUp {
      from { opacity: 0; transform: translateX(-50%) translateY(20px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
    @keyframes slideDown {
      from { opacity: 1; transform: translateX(-50%) translateY(0); }
      to { opacity: 0; transform: translateX(-50%) translateY(20px); }
    }
    @media (prefers-reduced-motion: reduce) {
      [data-cart-toast] { animation: none !important; opacity: 1 !important; }
    }
  `;
  document.head.appendChild(style);

  // Buy Now — adds the item then jumps straight to checkout, skipping the cart drawer.
  document.querySelectorAll('[data-buy-now]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const name = btn.dataset.buyNow;
      const price = parseFloat(btn.dataset.price);
      Cart.addItem(name, price, stepperQty(btn));
      window.location.href = '/checkout.html';
    });
  });

  // Absolute paths (leading slash) so they resolve correctly whether main.js
  // is loaded from a root page or a page inside products/.
  const CART_PRODUCT_IMAGES = {
    'Plaque': '/assets/products/plaque-01.jpg',
    'Desk Name Plaque': '/assets/products/desk-name-plaque-01.jpg',
    'Plaque Wood+Acrylic': '/assets/products/plaque-wood-acrylic-01.jpg',
    'Plaque Portrait A4': '/assets/products/plaque-portrait-a4-01.jpg',
    'Personalised Bookmark': '/assets/products/bookmark-01.jpg',
    'HG25 Keychain': '/assets/products/keychain-01.jpg',
    'Keychain': '/assets/products/keychain-03.jpg',
    'Phone Holder': '/assets/products/phone-holder-01.jpg',
    'Mas Kahwin/Hantaran Plaque': '/assets/products/maskahwin-plaque-01.jpg',
    'Rehal Lite': '/assets/products/rehal-lite-01.jpg',
    'Arah Sujud': '/assets/products/arah-sujud-01.jpg',
    'Quran Cover': '/assets/products/quran-cover-01.jpg',
    'Aqiqah Board': '/assets/products/maskahwin-plaque-01.jpg',
    'Penunjuk Al-Quran (1 side)': '/assets/products/penunjuk-quran-01.jpg',
    'Penunjuk Al-Quran (2 side)': '/assets/products/penunjuk-quran-01.jpg',
    'Mini Frame 12x10': '/assets/products/mini-frame-12x10-01.jpg',
    'Mini Frame 8x10': '/assets/products/mini-frame-8x10-01.jpg',
    'Fridge Magnet 70mm': '/assets/products/magnetic-frame-01.jpg',
    'Thank You Succulent HG25': '/assets/products/keychain-02.jpg'
  };

  function renderCart() {
    const cartItems = document.querySelector('[data-cart-items]');
    const cartEmpty = document.querySelector('[data-cart-empty]');
    const cartCheckout = document.querySelector('[data-cart-checkout]');
    const cartHeading = document.querySelector('.cart-modal__header h2');
    const cart = Cart.getCart();
    const count = cart.reduce((sum, item) => sum + item.qty, 0);

    if (cartHeading) cartHeading.textContent = count > 0 ? `Cart (${count})` : 'Your Cart';

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

    cartItems.innerHTML = cart.map(item => {
      const imageUrl = CART_PRODUCT_IMAGES[item.name] || 'https://images.unsplash.com/photo-1595079676339-1534801ad6cf?w=120&h=120&fit=crop';
      return `
      <div class="cart-modal__item">
        <div class="cart-modal__item-image">
          <img src="${imageUrl}" alt="${item.name}">
        </div>
        <div class="cart-modal__item-details">
          <p class="cart-modal__item-name">${item.name}</p>
          <p class="cart-modal__item-price">RM ${item.price.toFixed(2)}</p>
          <div class="cart-modal__item-controls">
            <button class="cart-modal__qty-btn" data-qty-minus="${item.name}" aria-label="Decrease quantity">−</button>
            <span class="cart-modal__qty-value">${item.qty}</span>
            <button class="cart-modal__qty-btn" data-qty-plus="${item.name}" aria-label="Increase quantity">+</button>
            <span class="cart-modal__item-remove" data-remove="${item.name}">Remove</span>
          </div>
        </div>
      </div>
    `;
    }).join('');

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
    document.querySelectorAll('[data-remove]').forEach(el => {
      el.addEventListener('click', () => {
        Cart.removeItem(el.dataset.remove);
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
