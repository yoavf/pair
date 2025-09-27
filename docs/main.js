
function updateParallax() {
  const scrollY = window.pageYOffset;
  const progress = Math.min(1, scrollY / 900);

  console.log('Scroll:', scrollY, 'Progress:', progress);

  const banner = document.getElementById('banner');
  const demo = document.getElementById('demo');
  const topGithub = document.getElementById('topGithub');
  const scrollArrow = document.querySelector('.scroll-arrow');

  if (topGithub) {
    if (progress > 0.7) {
      topGithub.classList.add('visible');
    } else {
      topGithub.classList.remove('visible');
    }
  }

  if (scrollArrow) {
    const documentHeight = Math.max(document.documentElement.scrollHeight, 2200);
    const midPoint = documentHeight / 2;

    if (scrollY > midPoint) {
      window.arrowPointingUp = true;
      scrollArrow.classList.add('flipped');
    } else {
      window.arrowPointingUp = false;
      scrollArrow.classList.remove('flipped');
    }
  }

  if (banner) {
    const bannerScale = Math.max(0.3, 1 - (progress * 0.7));

    // Smooth transition based on screen height - banner should stick to top on short screens
    const screenHeight = window.innerHeight;
    const startingPosition = screenHeight * 0.4;
    const targetTopPosition = 40;

    const upwardMovement = progress * (startingPosition - targetTopPosition);

    banner.style.transform = `translateY(calc(-50% - ${upwardMovement}px)) scale(${bannerScale})`;
    console.log('Banner scale:', bannerScale, 'Move up:', upwardMovement, 'Screen height:', window.innerHeight);
  }

  if (demo && window.innerWidth > 850) {
    let demoScale;

    if (scrollY <= 500) {
      demoScale = Math.min(2.0, 1 + (scrollY / 500 * 1.0));
    } else {
      demoScale = 2.0;
    }

    demo.style.transform = `scale(${demoScale})`;
    console.log('Demo scale:', demoScale, 'Simple scaling');
  } else if (demo) {
    // Reset transform on mobile
    demo.style.transform = 'none';
  }
}

function scrollToDemo() {
  const demo = document.getElementById('demo');
  if (demo) {
    const demoTop = demo.offsetTop;
    const viewportHeight = window.innerHeight;

    const targetScroll = demoTop - (viewportHeight * 0.3);

    window.scrollTo({
      top: Math.max(0, targetScroll),
      behavior: 'smooth'
    });
  }
}

// Demo carousel functionality
let currentDemo = 0;

function loadDemo(index, direction = 'right') {
  const videoContent = document.getElementById('videoContent');
  const demoTitle = document.getElementById('demoTitle');
  const demo = window.ASCIICASTS[index];

  if (!demo || !videoContent) return;

  // Start pixelation effect
  videoContent.classList.add('pixelating');

  setTimeout(() => {
    // Update content during peak pixelation
    videoContent.innerHTML = '';

    // Create and load new demo script
    const script = document.createElement('script');
    script.src = `https://asciinema.org/a/${demo.id}.js`;
    script.id = `asciicast-${demo.id}`;
    script.async = true;

    videoContent.appendChild(script);

    // Update title
    if (demoTitle) {
      demoTitle.textContent = demo.title;
    }

    // Remove pixelation and add full animation
    videoContent.classList.remove('pixelating');
    videoContent.classList.add('pixel-transition');

    // Clean up animation class
    setTimeout(() => {
      videoContent.classList.remove('pixel-transition');
    }, 600);

  }, 200);

  // Update active dot
  document.querySelectorAll('.demo-nav-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === index);
  });

  // Update button states
  const prevBtn = document.getElementById('demoNavPrev');
  const nextBtn = document.getElementById('demoNavNext');

  if (prevBtn) prevBtn.disabled = index === 0;
  if (nextBtn) nextBtn.disabled = index === window.ASCIICASTS.length - 1;
}

function nextDemo() {
  if (currentDemo < window.ASCIICASTS.length - 1) {
    currentDemo++;
    loadDemo(currentDemo, 'right');
  }
}

function prevDemo() {
  if (currentDemo > 0) {
    currentDemo--;
    loadDemo(currentDemo, 'left');
  }
}

function goToDemo(index) {
  if (index >= 0 && index < window.ASCIICASTS.length) {
    const direction = index > currentDemo ? 'right' : 'left';
    currentDemo = index;
    loadDemo(currentDemo, direction);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded...');
  updateParallax();

  // Initialize demo carousel
  if (window.ASCIICASTS && window.ASCIICASTS.length > 0) {
    loadDemo(0);

    // Setup navigation event listeners
    const prevBtn = document.getElementById('demoNavPrev');
    const nextBtn = document.getElementById('demoNavNext');

    if (prevBtn) prevBtn.addEventListener('click', prevDemo);
    if (nextBtn) nextBtn.addEventListener('click', nextDemo);

    // Setup dot navigation
    document.querySelectorAll('.demo-nav-dot').forEach((dot, index) => {
      dot.addEventListener('click', () => goToDemo(index));
    });

    // Setup keyboard navigation
    document.addEventListener('keydown', (e) => {
      // Only handle arrow keys when demo is visible and not typing in an input
      if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          prevDemo();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          nextDemo();
        }
      }
    });
  }

  const actionBtn = document.getElementById('actionBtn');
  if (actionBtn) {
    actionBtn.addEventListener('click', (e) => {
      e.preventDefault();
      scrollToDemo();
    });
  }

  window.arrowPointingUp = false;

  const scrollArrow = document.querySelector('.scroll-arrow');
  if (scrollArrow) {
    scrollArrow.addEventListener('click', () => {
      if (window.arrowPointingUp) {
        // Arrow is pointing up, scroll back to demo
        window.scrollTo({
          top: 850,
          behavior: 'smooth'
        });
      } else {
        // Arrow is pointing down, scroll to FAQ
        window.scrollTo({
          top: 1600,
          behavior: 'smooth'
        });
      }
    });
  }
});

// Add scroll listener
window.addEventListener('scroll', updateParallax, { passive: true });
console.log('Scroll listener added');