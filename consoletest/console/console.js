let selectedGame = null;

function goToPage(pageId) {
  document.querySelectorAll(".screen").forEach(screen => screen.classList.remove("active"));
  const page = document.getElementById(pageId);
  if (page) page.classList.add("active");
}

function initializeCardSlider(containerSelector) {
  const slider = document.querySelector(containerSelector);
  if (!slider) return;

  const cards = slider.querySelectorAll('.card');
  const body = document.body;

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.75) {
        const bgColor = entry.target.getAttribute('data-bg-color');
        body.style.backgroundColor = bgColor;
        entry.target.classList.add('is-active');
      } else {
        entry.target.classList.remove('is-active');
      }
    });
  }, { root: slider, threshold: 0.75 });

  cards.forEach(card => observer.observe(card));

  // Click on card → go to confirm page
cards.forEach(card => {
  card.addEventListener('click', () => {
    selectedGame = card.getAttribute('data-game-name');
    const videoEl = card.querySelector('video');
    const descEl = card.querySelector('p');

    // Update confirm page content
    document.getElementById("chosen-game-title").innerText = `You chose: ${selectedGame}`;
    document.getElementById("chosen-game-desc").innerText = descEl ? descEl.innerText : "";
    document.getElementById("chosen-game-video").src = videoEl.querySelector("source").src;

    goToPage('page_confirm');
  });
});

  // Center the middle card instantly (no animation)
  const middleIndex = Math.floor(cards.length / 2);
  const middleCard = cards[middleIndex];
  if (middleCard) {
    const offset = middleCard.offsetLeft - (slider.clientWidth / 2) + (middleCard.clientWidth / 2);
    slider.scrollLeft = offset; // directly set position (no smooth scroll)
  }
}

window.onload = () => {
  goToPage('page_choose_game');
  initializeCardSlider('#game-card-container');
};
