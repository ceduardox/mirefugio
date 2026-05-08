const qrModal = document.querySelector('[data-qr-modal]');
const qrClose = document.querySelector('[data-close-qr]');
const phoneInput = document.querySelector('#phone-input');
const phoneFull = document.querySelector('#phone-full');
const phoneCountry = document.querySelector('#phone-country');

document.querySelectorAll('[data-open-qr]').forEach((button) => {
  if (qrModal) {
    button.addEventListener('click', () => qrModal.showModal());
  }
});

if (qrModal) {
  qrModal.addEventListener('click', (event) => {
    if (event.target === qrModal) {
      qrModal.close();
    }
  });
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

document.querySelectorAll('[data-share]').forEach((button) => {
  button.addEventListener('click', async () => {
    const url = button.dataset.share;
    const title = button.dataset.shareTitle || document.title;
    const text = button.dataset.shareText || '';
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    const previous = button.textContent;
    button.textContent = 'Link copiado';
    setTimeout(() => {
      button.textContent = previous;
    }, 1600);
  });
});

document.querySelectorAll('[data-loading-form]').forEach((form) => {
  form.addEventListener('submit', () => {
    const button = form.querySelector('button[type="submit"]');
    if (button) {
      button.dataset.originalText = button.textContent;
      button.textContent = 'Procesando...';
      button.disabled = true;
    }
  });
});

document.querySelectorAll('[data-confirm]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    if (!confirm(form.dataset.confirm)) {
      event.preventDefault();
    }
  });
});

function formatFileSize(bytes) {
  if (!bytes) return '0 KB';
  const units = ['B', 'KB', 'MB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

document.querySelectorAll('[data-enhanced-upload]').forEach((form) => {
  const input = form.querySelector('input[type="file"]');
  const preview = form.querySelector('[data-file-preview]');
  const progress = form.querySelector('[data-upload-progress]');
  const progressBar = progress?.querySelector('span');
  const button = form.querySelector('button[type="submit"]');

  input?.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file || !preview) return;
    const isImage = file.type.startsWith('image/');
    const url = isImage ? URL.createObjectURL(file) : '';
    preview.hidden = false;
    preview.innerHTML = `
      ${isImage ? `<img src="${url}" alt="Vista previa">` : '<div class="pdf-preview">PDF</div>'}
      <div><strong>${file.name}</strong><small>${formatFileSize(file.size)}</small></div>
    `;
  });

  form.addEventListener('submit', (event) => {
    if (!window.XMLHttpRequest || !input?.files?.length) return;
    event.preventDefault();
    const xhr = new XMLHttpRequest();
    const data = new FormData(form);

    if (button) {
      button.disabled = true;
      button.dataset.originalText = button.textContent;
      button.textContent = 'Subiendo...';
    }
    if (progress) {
      progress.hidden = false;
    }

    xhr.upload.addEventListener('progress', (progressEvent) => {
      if (!progressEvent.lengthComputable || !progressBar) return;
      const percent = Math.max(8, Math.round((progressEvent.loaded / progressEvent.total) * 100));
      progressBar.style.width = `${percent}%`;
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 400) {
        if (progressBar) progressBar.style.width = '100%';
        window.location.href = xhr.responseURL || window.location.href;
        return;
      }
      if (button) {
        button.disabled = false;
        button.textContent = button.dataset.originalText || 'Enviar';
      }
      alert('No se pudo subir el archivo. Revisa el formato y el peso.');
    });

    xhr.addEventListener('error', () => {
      if (button) {
        button.disabled = false;
        button.textContent = button.dataset.originalText || 'Enviar';
      }
      alert('No se pudo conectar para subir el archivo.');
    });

    xhr.open(form.method || 'POST', form.action);
    xhr.send(data);
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
