const qrButton = document.querySelector('[data-open-qr]');
const qrModal = document.querySelector('[data-qr-modal]');
const qrClose = document.querySelector('[data-close-qr]');

if (qrButton && qrModal) {
  qrButton.addEventListener('click', () => qrModal.showModal());
}

if (qrClose && qrModal) {
  qrClose.addEventListener('click', () => qrModal.close());
}

document.querySelectorAll('[data-copy]').forEach((button) => {
  button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(button.dataset.copy);
    const previous = button.textContent;
    button.textContent = 'Link copiado';
    setTimeout(() => {
      button.textContent = previous;
    }, 1600);
  });
});
