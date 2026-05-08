const qrButton = document.querySelector('[data-open-qr]');
const qrModal = document.querySelector('[data-qr-modal]');
const qrClose = document.querySelector('[data-close-qr]');
const phoneInput = document.querySelector('#phone-input');
const phoneFull = document.querySelector('#phone-full');
const phoneCountry = document.querySelector('#phone-country');

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

if (phoneInput && window.intlTelInput) {
  const iti = window.intlTelInput(phoneInput, {
    initialCountry: 'auto',
    nationalMode: false,
    separateDialCode: true,
    geoIpLookup: (success, failure) => {
      fetch('https://ipapi.co/json/')
        .then((response) => response.json())
        .then((data) => success((data.country_code || 'BO').toLowerCase()))
        .catch(() => {
          success('bo');
          if (failure) failure();
        });
    },
    loadUtils: () => import('https://cdn.jsdelivr.net/npm/intl-tel-input@25.3.1/build/js/utils.js')
  });

  const syncPhoneFields = () => {
    const country = iti.getSelectedCountryData();
    phoneFull.value = iti.getNumber() || phoneInput.value;
    if (phoneCountry) {
      phoneCountry.value = (country.iso2 || '').toUpperCase();
    }
  };

  phoneInput.form?.addEventListener('submit', syncPhoneFields);
  phoneInput.addEventListener('blur', syncPhoneFields);
  phoneInput.addEventListener('countrychange', syncPhoneFields);
}
