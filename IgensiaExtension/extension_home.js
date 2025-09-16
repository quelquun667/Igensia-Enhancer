document.addEventListener('DOMContentLoaded', () => {
    const showDevoirsBtn = document.getElementById('show-devoirs-btn');
    const homeView = document.getElementById('home-view');
    const devoirsIframe = document.getElementById('devoirs-iframe');

    if (showDevoirsBtn && homeView && devoirsIframe) {
        showDevoirsBtn.addEventListener('click', () => {
            homeView.style.display = 'none';
            devoirsIframe.style.display = 'block';
        });
    }
});
