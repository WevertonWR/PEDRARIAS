// ===== SCROLL REVEAL (REMOVED) =====
// ===== NAVBAR SCROLL =====
function initNavbar() {
  const navbar = document.querySelector('.navbar');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 60) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  });
}

// ===== FAQ ACCORDION =====
function initFAQ() {
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.parentElement;
      const isActive = item.classList.contains('active');
      document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('active'));
      if (!isActive) item.classList.add('active');
    });
  });
}

// ===== COUNTDOWN TIMER =====
function initCountdown() {
  const countdownEl = document.getElementById('countdown');
  if (!countdownEl) return;

  const duration = 6 * 60 * 60 * 1000; // 6 hours
  let expires = localStorage.getItem('offerExpires');
  const now = new Date().getTime();

  if (!expires || now > parseInt(expires)) {
    expires = now + duration;
    localStorage.setItem('offerExpires', expires);
  }

  setInterval(() => {
    const currentTime = new Date().getTime();
    let timeLeft = parseInt(expires) - currentTime;

    if (timeLeft <= 0) {
      expires = currentTime + duration;
      localStorage.setItem('offerExpires', expires);
      timeLeft = duration;
    }

    const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);

    countdownEl.innerHTML = 
      String(hours).padStart(2, '0') + ":" + 
      String(minutes).padStart(2, '0') + ":" + 
      String(seconds).padStart(2, '0');
  }, 1000);
}

// ===== PARALLAX (REMOVED) =====

// ===== SMOOTH CTA SCROLL =====
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
  initFAQ();
  initCountdown();
  initSmoothScroll();
});
