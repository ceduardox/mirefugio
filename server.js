require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;
const baseUrl = (process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, '');
const ticketPriceLabel = process.env.TICKET_PRICE_LABEL || 'Bs 20';
const raffleTitle = process.env.RAFFLE_TITLE || 'Rifa solidaria Mi Refugio SC';
const rafflePrize = process.env.RAFFLE_PRIZE || 'Premio sorpresa para ayudar a nuestros perritos';
const raffleDrawDate = process.env.RAFFLE_DRAW_DATE || 'Fecha por anunciar';
const raffleImpact = process.env.RAFFLE_IMPACT || 'Alimento, rescates y atencion veterinaria';
const adminPassword = process.env.ADMIN_PASSWORD || 'admin';
const databaseUrl = process.env.DATABASE_URL;
const rootDir = __dirname;
const publicDir = path.join(rootDir, 'public');
const logoPath = path.join(rootDir, 'logo mi refugio.jpg');

const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false }
    })
  : null;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    cb(allowed.includes(file.mimetype) ? null : new Error('Formato no permitido'), allowed.includes(file.mimetype));
  }
});

const qrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    cb(allowed.includes(file.mimetype) ? null : new Error('El QR debe ser imagen JPG, PNG o WEBP'), allowed.includes(file.mimetype));
  }
});

app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicDir));

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeWhatsapp(value = '') {
  return value.replace(/[^\d+]/g, '').slice(0, 24);
}

function normalizeCountryCode(value = '') {
  return value.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase();
}

function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase().slice(0, 160);
}

function safeDownloadName(value = '') {
  const cleaned = String(value).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80);
  return cleaned || 'qr-mi-refugio.png';
}

function statusCopy(status) {
  return {
    awaiting_receipt: 'Esperando comprobante',
    pending_review: 'Comprobante en revision',
    approved: 'Ticket aprobado',
    rejected: 'Comprobante observado'
  }[status] || status;
}

function progressStep(status) {
  if (status === 'approved') return 4;
  if (status === 'pending_review') return 3;
  if (status === 'rejected') return 2;
  return 1;
}

function progressMarkup(status) {
  const current = progressStep(status);
  const steps = [
    ['Registro', 'Datos guardados'],
    ['Pago QR', 'Comprobante'],
    ['Revision', 'Validacion admin'],
    ['Ticket', 'Numero aprobado']
  ];
  return `<div class="progress-track" aria-label="Progreso del ticket">
    ${steps.map(([title, text], index) => {
      const step = index + 1;
      const state = step < current ? 'done' : step === current ? 'active' : '';
      return `<div class="progress-step ${state}">
        <span>${step}</span>
        <strong>${title}</strong>
        <small>${text}</small>
      </div>`;
    }).join('')}
  </div>`;
}

function requireDb(req, res, next) {
  if (!pool) {
    res.status(503).send(page('Base de datos requerida', `
      <main class="shell compact">
        <section class="notice">
          <img class="brand-mark" src="/logo" alt="Mi Refugio SC">
          <h1>Falta configurar PostgreSQL</h1>
          <p>Define <code>DATABASE_URL</code> en Railway o en tu archivo <code>.env</code> local.</p>
        </section>
      </main>
    `));
    return;
  }
  next();
}

async function ensureSchema() {
  if (!pool) return;
  const sql = fs.readFileSync(path.join(rootDir, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

function adminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [type, token] = header.split(' ');
  const credentials = token ? Buffer.from(token, 'base64').toString('utf8') : '';
  const password = credentials.split(':')[1] || '';
  const given = Buffer.from(password);
  const expected = Buffer.from(adminPassword);
  if (type === 'Basic' && given.length === expected.length && crypto.timingSafeEqual(given, expected)) {
    next();
    return;
  }
  res.set('WWW-Authenticate', 'Basic realm="Mi Refugio Admin"');
  res.status(401).send('Acceso admin requerido');
}

function ticketLink(publicId) {
  return `${baseUrl}/t/${publicId}`;
}

function page(title, body) {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | Mi Refugio SC</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700;800&family=Sora:wght@600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/intl-tel-input@25.3.1/build/css/intlTelInput.css">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  ${body}
  <script src="https://cdn.jsdelivr.net/npm/intl-tel-input@25.3.1/build/js/intlTelInput.min.js"></script>
  <script src="/app.js"></script>
</body>
</html>`;
}

function paymentQrPath() {
  for (const name of ['payment-qr.png', 'payment-qr.jpg', 'payment-qr.jpeg']) {
    const filePath = path.join(publicDir, name);
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}

async function getStoredPaymentQr() {
  if (!pool) return null;
  const { rows } = await pool.query(
    "SELECT file_name, mime_type, data, updated_at FROM app_settings WHERE key = 'payment_qr'"
  );
  return rows[0] || null;
}

app.get('/logo', (_req, res) => {
  if (fs.existsSync(logoPath)) {
    res.sendFile(logoPath);
    return;
  }
  res.status(404).send('Logo no encontrado');
});

app.get('/payment-qr', async (_req, res, next) => {
  try {
    const storedQr = await getStoredPaymentQr();
    if (storedQr && storedQr.data) {
      res.set('Cache-Control', 'no-store');
      res.type(storedQr.mime_type).send(storedQr.data);
      return;
    }
    if (process.env.PAYMENT_QR_URL) {
      res.redirect(process.env.PAYMENT_QR_URL);
      return;
    }
    const filePath = paymentQrPath();
    if (filePath) {
      res.sendFile(filePath);
      return;
    }
    res.type('svg').send(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" viewBox="0 0 900 900">
      <rect width="900" height="900" fill="#fff"/>
      <rect x="70" y="70" width="210" height="210" fill="none" stroke="#111" stroke-width="34"/>
      <rect x="620" y="70" width="210" height="210" fill="none" stroke="#111" stroke-width="34"/>
      <rect x="70" y="620" width="210" height="210" fill="none" stroke="#111" stroke-width="34"/>
      <path d="M370 90h80v80h-80zm120 0h60v140h-60zm-120 170h180v70H370zm-10 120h90v90h-90zm150 0h70v70h-70zm110 0h150v90H620zm-260 150h70v180h-70zm110 0h180v70H470zm250 0h70v70h-70zm-250 130h70v80h-70zm130 0h210v150H600z" fill="#111"/>
      <text x="450" y="430" text-anchor="middle" font-family="Arial, sans-serif" font-size="38" font-weight="700" fill="#d71920">QR de pago</text>
      <text x="450" y="485" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" fill="#222">Subir QR desde admin</text>
    </svg>`);
  } catch (error) {
    next(error);
  }
});

app.get('/payment-qr/download', async (_req, res, next) => {
  try {
    const storedQr = await getStoredPaymentQr();
    if (storedQr && storedQr.data) {
      res.set('Content-Disposition', `attachment; filename="${safeDownloadName(storedQr.file_name)}"`);
      res.type(storedQr.mime_type).send(storedQr.data);
      return;
    }
    const filePath = paymentQrPath();
    if (filePath) {
      res.download(filePath);
      return;
    }
    res.redirect('/payment-qr');
  } catch (error) {
    next(error);
  }
});

app.get('/', requireDb, (_req, res) => {
  res.send(page('Comprar ticket', `
    <main class="shell">
      <nav class="landing-nav">
        <a href="/" class="brand-link"><img src="/logo" alt="Mi Refugio SC"><span>Mi Refugio SC</span></a>
        <div class="nav-actions">
          <a class="ghost-btn" href="/login">Ingresar</a>
          <a class="primary-btn" href="#comprar">Registrarme</a>
        </div>
      </nav>
      <section class="purchase-panel">
        <div class="brand-block">
          <div class="hero-logo-row">
            <img class="brand-mark large" src="/logo" alt="Mi Refugio SC">
            <div class="price-badge">
              <span>Ticket</span>
              <strong>${escapeHtml(ticketPriceLabel)}</strong>
            </div>
          </div>
          <p class="eyebrow">Ticket solidario virtual</p>
          <h1>${escapeHtml(raffleTitle)}</h1>
          <p class="lead">Participa, ayuda y recibe un ticket digital unico cuando validemos tu comprobante.</p>
          <div class="quick-facts">
            <span>${escapeHtml(ticketPriceLabel)}</span>
            <span>${escapeHtml(raffleDrawDate)}</span>
            <span>Pago seguro por QR</span>
          </div>
          <section class="prize-showcase" aria-label="Premios e impacto">
            <div class="prize-card main-prize">
              <p class="eyebrow">Premio destacado</p>
              <h2>${escapeHtml(rafflePrize)}</h2>
              <small>Configurable desde Railway para cada campana.</small>
            </div>
            <div class="prize-card">
              <p class="eyebrow">Tu ayuda cubre</p>
              <h2>${escapeHtml(raffleImpact)}</h2>
              <small>Cada ticket suma al cuidado diario del refugio.</small>
            </div>
          </section>
          <section class="dog-feature" aria-label="Mi Refugio ayuda a perritos">
            <img src="/assets/refuge-dog-scene.svg" alt="Perrito frente al refugio Mi Refugio SC">
            <div>
              <p class="eyebrow">Causa solidaria</p>
              <h2>Tu ticket deja huella</h2>
              <p>La rifa ayuda a sostener alimento, rescates y atencion para perritos que esperan una nueva oportunidad.</p>
            </div>
          </section>
          <section class="process-strip" aria-label="Proceso de compra">
            <div><span>1</span><strong>Registras</strong><small>Nombre y WhatsApp</small></div>
            <div><span>2</span><strong>Pagas QR</strong><small>Desde tu banco</small></div>
            <div><span>3</span><strong>Subes</strong><small>Comprobante</small></div>
            <div><span>4</span><strong>Recibes</strong><small>Ticket aprobado</small></div>
          </section>
        </div>
        <form id="comprar" class="form-card premium-form" method="post" action="/tickets" data-loading-form>
          <div class="form-heading">
            <span>Registro rapido</span>
            <strong>Datos para tu ticket</strong>
            <small>Tu numero se activa cuando el comprobante sea revisado por Mi Refugio.</small>
          </div>
          <label>Nombre completo
            <input name="buyer_name" autocomplete="name" placeholder="Ej. Maria Fernandez" required>
          </label>
          <label>WhatsApp o correo
            <input name="login_id" autocomplete="username" placeholder="Ej. +59170000000 o tu@email.com" required>
          </label>
          <label>Correo opcional
            <input name="email" type="email" autocomplete="email" placeholder="tu@email.com">
          </label>
          <label>Crear contrasena
            <input name="password" type="password" autocomplete="new-password" minlength="6" placeholder="Minimo 6 caracteres" required>
          </label>
          <label>Repetir contrasena
            <input name="password_confirm" type="password" autocomplete="new-password" minlength="6" placeholder="Confirma tu contrasena" required>
          </label>
          <button class="primary-btn" type="submit">Comprar ticket solidario</button>
          <p class="trust-note">Despues veras el QR, subiras tu comprobante y podras volver con tu link.</p>
        </form>
      </section>
    </main>
  `));
});

app.get('/login', requireDb, (_req, res) => {
  res.send(page('Ingresar', `
    <main class="shell compact">
      <nav class="topbar">
        <a href="/" class="brand-link"><img src="/logo" alt="Mi Refugio SC"><span>Mi Refugio SC</span></a>
        <a class="ghost-btn" href="/#comprar">Registrarme</a>
      </nav>
      <section class="auth-layout">
        <div class="auth-intro">
          <img class="brand-mark large" src="/logo" alt="Mi Refugio SC">
          <p class="eyebrow">Consulta tu ticket</p>
          <h1>Ingresa para ver el estado de tu ticket</h1>
          <p>Usa el mismo WhatsApp o correo y contrasena que registraste al comprar. Te llevaremos a tu ticket mas reciente.</p>
        </div>
        <form class="form-card auth-card" method="post" action="/login" data-loading-form>
          <div class="form-heading">
            <span>Login</span>
            <strong>Acceso comprador</strong>
            <small>Si aun no compraste, registrate para generar tu ticket.</small>
          </div>
          <label>Numero de telefono
            <input id="phone-input" name="phone_display" type="tel" inputmode="tel" autocomplete="tel" placeholder="Tu numero de WhatsApp" required>
            <input id="phone-full" name="whatsapp" type="hidden">
            <input id="phone-country" name="phone_country" type="hidden">
          </label>
          <label>Contrasena
            <input name="password" type="password" autocomplete="current-password" minlength="6" placeholder="Tu contrasena" required>
          </label>
          <button class="primary-btn" type="submit">Ingresar a mi ticket</button>
          <p class="trust-note">No necesitas recordar el link si usas el mismo WhatsApp/correo y contrasena.</p>
        </form>
      </section>
    </main>
  `));
});

app.post('/login', requireDb, async (req, res, next) => {
  try {
    const loginId = String(req.body.login_id || '').trim();
    const email = loginId.includes('@') ? normalizeEmail(loginId) : '';
    const whatsapp = email ? '' : normalizeWhatsapp(loginId);
    const password = String(req.body.password || '');
    const { rows } = await pool.query(
      `SELECT public_id, password_hash
       FROM tickets
       WHERE password_hash IS NOT NULL
         AND (($1 <> '' AND whatsapp = $1) OR ($2 <> '' AND LOWER(email) = $2))
       ORDER BY created_at DESC
       LIMIT 1`,
      [whatsapp, email]
    );
    const ticket = rows[0];
    const isValid = ticket ? await bcrypt.compare(password, ticket.password_hash) : false;
    if (!isValid) {
      res.status(401).send(page('No pudimos ingresar', `
        <main class="shell compact">
          <section class="notice">
            <img class="brand-mark" src="/logo" alt="Mi Refugio SC">
            <h1>No encontramos ese acceso</h1>
            <p>Revisa tu WhatsApp/correo y contrasena. Deben ser los mismos datos usados al registrarte.</p>
            <div class="modal-actions">
              <a class="primary-btn" href="/login">Intentar de nuevo</a>
              <a class="ghost-btn" href="/#comprar">Registrarme</a>
            </div>
          </section>
        </main>
      `));
      return;
    }
    res.redirect(`/t/${ticket.public_id}`);
  } catch (error) {
    next(error);
  }
});

app.post('/tickets', requireDb, async (req, res, next) => {
  try {
    const publicId = crypto.randomUUID();
    const buyerName = String(req.body.buyer_name || '').trim().slice(0, 120);
    const whatsapp = normalizeWhatsapp(req.body.whatsapp || req.body.phone_display || '');
    const phoneCountry = normalizeCountryCode(req.body.phone_country || '');
    const email = String(req.body.email || '').trim().slice(0, 160);
    const password = String(req.body.password || '');
    const passwordConfirm = String(req.body.password_confirm || '');
    if (password.length < 6 || password !== passwordConfirm) {
      res.status(400).send(page('Revisa tu contrasena', `
        <main class="shell compact">
          <section class="notice">
            <img class="brand-mark" src="/logo" alt="Mi Refugio SC">
            <h1>Las contrasenas no coinciden</h1>
            <p>Vuelve al formulario y confirma una contrasena de al menos 6 caracteres.</p>
            <a class="primary-btn" href="/">Volver</a>
          </section>
        </main>
      `));
      return;
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO tickets (public_id, buyer_name, whatsapp, phone_country, email, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING public_id`,
      [publicId, buyerName, whatsapp, phoneCountry, email, passwordHash]
    );
    res.redirect(`/t/${result.rows[0].public_id}`);
  } catch (error) {
    next(error);
  }
});

app.get('/t/:publicId', requireDb, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tickets WHERE public_id = $1', [req.params.publicId]);
    const ticket = rows[0];
    if (!ticket) {
      res.status(404).send(page('Ticket no encontrado', '<main class="shell compact"><section class="notice"><h1>Ticket no encontrado</h1></section></main>'));
      return;
    }

    const approvedTicket = ticket.status === 'approved' ? `
      <section class="ticket-card">
        <div class="ticket-cut left"></div>
        <div class="ticket-cut right"></div>
        <div>
          <p class="eyebrow">Mi Refugio SC</p>
          <h2>${escapeHtml(ticket.ticket_number)}</h2>
          <p>A nombre de ${escapeHtml(ticket.buyer_name || 'Colaborador')}</p>
        </div>
        <img src="/logo" alt="Mi Refugio SC">
        <div class="ticket-footer">
          <span>Ticket solidario</span>
          <span>${new Date(ticket.approved_at).toLocaleDateString('es-BO')}</span>
        </div>
      </section>
    ` : '';

    const uploadForm = ticket.status !== 'approved' ? `
      <section class="content-card payment-card">
        <div class="section-title">
          <div>
            <p class="eyebrow">Pago y comprobante</p>
            <h2>${ticket.status === 'pending_review' ? 'Tu comprobante esta en revision' : ticket.status === 'rejected' ? 'Sube un nuevo comprobante' : 'Paga con QR y sube tu comprobante'}</h2>
            <p class="muted">${ticket.status === 'pending_review' ? 'Ya recibimos tu archivo. El equipo de Mi Refugio lo revisara antes de activar tu numero.' : 'Descarga o amplia el QR, paga desde tu banco y sube una foto o PDF del comprobante.'}</p>
          </div>
        </div>
        ${ticket.status === 'rejected' ? `<div class="state-alert rejected"><strong>Comprobante observado</strong><p>${escapeHtml(ticket.admin_note || 'El comprobante necesita revision. Sube una imagen o PDF nuevo para continuar.')}</p></div>` : ''}
        <div class="payment-grid">
          <div class="qr-panel">
            <button class="qr-frame" type="button" data-open-qr>
              <img src="/payment-qr" alt="QR de pago Mi Refugio SC">
            </button>
            <div class="qr-actions">
              <button class="ghost-btn" type="button" data-open-qr>Ampliar QR</button>
              <a class="ghost-btn" href="/payment-qr/download">Descargar QR</a>
            </div>
          </div>
          <form class="upload-box enhanced-upload" method="post" action="/t/${ticket.public_id}/receipt" enctype="multipart/form-data" data-enhanced-upload>
            <p class="eyebrow">Comprobante</p>
            <h2>${ticket.status === 'pending_review' ? 'Reemplazar comprobante' : 'Sube tu comprobante'}</h2>
            <label class="file-drop">
              <input type="file" name="receipt" accept="image/png,image/jpeg,image/webp,application/pdf" required>
              <span class="file-icon">PDF/JPG</span>
              <strong>Seleccionar archivo</strong>
              <small>JPG, PNG, WEBP o PDF hasta 6 MB</small>
            </label>
            <div class="file-preview" data-file-preview hidden></div>
            <div class="upload-progress" data-upload-progress hidden><span></span></div>
            <button class="primary-btn" type="submit">${ticket.status === 'pending_review' ? 'Enviar reemplazo' : 'Enviar comprobante a revision'}</button>
            <p class="trust-note">Tu ticket se aprueba cuando el admin confirme el pago.</p>
          </form>
        </div>
      </section>
    ` : '';

    res.send(page('Ticket virtual', `
      <main class="shell narrow">
        <nav class="topbar">
          <a href="/" class="brand-link"><img src="/logo" alt="Mi Refugio SC"><span>Mi Refugio SC</span></a>
          <button class="ghost-btn" type="button" data-copy="${escapeHtml(ticketLink(ticket.public_id))}">Copiar link</button>
        </nav>
        <section class="status-hero ${ticket.status}">
          <p class="eyebrow">${escapeHtml(statusCopy(ticket.status))}</p>
          <h1>${ticket.status === 'approved' ? 'Tu ticket esta aprobado' : 'Tu compra esta registrada'}</h1>
          <p>Guarda este enlace para revisar el avance y compartir tu ticket cuando este aprobado.</p>
          <div class="buyer-row">
            <span>${escapeHtml(ticket.buyer_name || 'Colaborador')}</span>
            <span>${escapeHtml(ticket.whatsapp || '')}</span>
          </div>
          ${progressMarkup(ticket.status)}
        </section>
        ${approvedTicket}
        ${uploadForm}
      </main>
      <dialog class="qr-modal" data-qr-modal>
        <button class="icon-btn" type="button" data-close-qr aria-label="Cerrar">x</button>
        <p class="eyebrow">QR de pago</p>
        <h2>Escanea o descarga el QR</h2>
        <img src="/payment-qr" alt="QR de pago Mi Refugio SC ampliado">
        <div class="modal-actions">
          <a class="primary-btn" href="/payment-qr/download">Descargar QR</a>
          <button class="ghost-btn" type="button" data-copy="${escapeHtml(ticketLink(ticket.public_id))}">Copiar link</button>
        </div>
      </dialog>
    `));
  } catch (error) {
    next(error);
  }
});

app.post('/t/:publicId/receipt', requireDb, upload.single('receipt'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).send('Debes subir un comprobante valido.');
      return;
    }
    await pool.query(
      `UPDATE tickets
       SET status = 'pending_review',
           receipt_file_name = $2,
           receipt_mime_type = $3,
           receipt_data = $4,
           receipt_uploaded_at = NOW(),
           rejected_at = NULL,
           admin_note = NULL
       WHERE public_id = $1`,
      [req.params.publicId, req.file.originalname, req.file.mimetype, req.file.buffer]
    );
    res.redirect(`/t/${req.params.publicId}`);
  } catch (error) {
    next(error);
  }
});

app.get('/admin', requireDb, adminAuth, async (_req, res, next) => {
  try {
    const storedQr = await getStoredPaymentQr();
    const statsResult = await pool.query(`
      SELECT
        COUNT(*)::INT AS total,
        COUNT(*) FILTER (WHERE status = 'pending_review')::INT AS pending,
        COUNT(*) FILTER (WHERE status = 'approved')::INT AS approved,
        COUNT(*) FILTER (WHERE status = 'rejected')::INT AS rejected
      FROM tickets
    `);
    const stats = statsResult.rows[0] || { total: 0, pending: 0, approved: 0, rejected: 0 };
    const { rows } = await pool.query(`
      SELECT id, public_id, ticket_number, buyer_name, whatsapp, status, created_at, receipt_uploaded_at
      FROM tickets
      ORDER BY
        CASE WHEN status = 'pending_review' THEN 0 WHEN status = 'awaiting_receipt' THEN 1 WHEN status = 'rejected' THEN 2 ELSE 3 END,
        COALESCE(receipt_uploaded_at, created_at) DESC
      LIMIT 200
    `);
    const items = rows.map((ticket) => `
      <article class="admin-row ${ticket.status}">
        <div>
          <strong>${escapeHtml(ticket.buyer_name || 'Sin nombre')}</strong>
          <span>${escapeHtml(ticket.whatsapp || '')}</span>
          <small>${escapeHtml(statusCopy(ticket.status))} - ${new Date(ticket.created_at).toLocaleString('es-BO')}</small>
        </div>
        <div class="admin-actions">
          <a class="ghost-btn" href="/t/${ticket.public_id}" target="_blank">Ver</a>
          ${ticket.receipt_uploaded_at ? `<a class="ghost-btn" href="/admin/tickets/${ticket.id}/receipt" target="_blank">Comprobante</a>` : ''}
          ${ticket.receipt_uploaded_at ? `<form method="post" action="/admin/tickets/${ticket.id}/approve" data-confirm="Aprobar este comprobante y generar ticket?"><button class="primary-btn" type="submit">Aprobar</button></form>` : '<button class="ghost-btn" type="button" disabled>Sin comprobante</button>'}
          <details class="observe-box">
            <summary>Observar</summary>
            <form method="post" action="/admin/tickets/${ticket.id}/reject" data-loading-form>
              <textarea name="admin_note" rows="2" maxlength="240" placeholder="Motivo para el usuario" required></textarea>
              <button class="danger-btn" type="submit">Guardar observacion</button>
            </form>
          </details>
        </div>
      </article>
    `).join('');
    res.send(page('Admin', `
      <main class="shell narrow">
        <nav class="topbar">
          <a href="/" class="brand-link"><img src="/logo" alt="Mi Refugio SC"><span>Admin tickets</span></a>
        </nav>
        <section class="content-card qr-admin-card">
          <div class="section-title">
            <div>
              <p class="eyebrow">QR bancario</p>
              <h1>Imagen de pago</h1>
              <p class="muted">${storedQr ? `QR actualizado: ${new Date(storedQr.updated_at).toLocaleString('es-BO')}` : 'Aun no se subio un QR real. Los usuarios veran un QR temporal.'}</p>
            </div>
            <a class="ghost-btn" href="/payment-qr" target="_blank">Ver QR actual</a>
          </div>
          <div class="qr-admin-grid">
            <img class="qr-preview" src="/payment-qr" alt="QR de pago actual">
            <form class="upload-box enhanced-upload" method="post" action="/admin/payment-qr" enctype="multipart/form-data" data-enhanced-upload>
              <label class="file-drop">Subir o reemplazar QR
                <input type="file" name="payment_qr" accept="image/png,image/jpeg,image/webp" required>
                <span class="file-icon">QR</span>
                <strong>Seleccionar imagen QR</strong>
                <small>JPG, PNG o WEBP hasta 4 MB</small>
              </label>
              <div class="file-preview" data-file-preview hidden></div>
              <div class="upload-progress" data-upload-progress hidden><span></span></div>
              <button class="primary-btn" type="submit">Guardar QR de pago</button>
            </form>
          </div>
        </section>
        <section class="admin-stats" aria-label="Resumen admin">
          <div><span>${stats.pending}</span><strong>En revision</strong></div>
          <div><span>${stats.approved}</span><strong>Aprobados</strong></div>
          <div><span>${stats.rejected}</span><strong>Observados</strong></div>
          <div><span>${stats.total}</span><strong>Total tickets</strong></div>
        </section>
        <section class="content-card">
          <div class="section-title">
            <div>
              <p class="eyebrow">Revision</p>
              <h1>Comprobantes recibidos</h1>
            </div>
          </div>
          <div class="admin-list">${items || '<p>No hay tickets todavia.</p>'}</div>
        </section>
      </main>
    `));
  } catch (error) {
    next(error);
  }
});

app.post('/admin/payment-qr', requireDb, adminAuth, qrUpload.single('payment_qr'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).send('Debes subir una imagen QR valida.');
      return;
    }
    await pool.query(
      `INSERT INTO app_settings (key, file_name, mime_type, data, updated_at)
       VALUES ('payment_qr', $1, $2, $3, NOW())
       ON CONFLICT (key)
       DO UPDATE SET file_name = EXCLUDED.file_name,
                     mime_type = EXCLUDED.mime_type,
                     data = EXCLUDED.data,
                     updated_at = NOW()`,
      [req.file.originalname, req.file.mimetype, req.file.buffer]
    );
    res.redirect('/admin');
  } catch (error) {
    next(error);
  }
});

app.get('/admin/tickets/:id/receipt', requireDb, adminAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT receipt_mime_type, receipt_data FROM tickets WHERE id = $1', [req.params.id]);
    const ticket = rows[0];
    if (!ticket || !ticket.receipt_data) {
      res.status(404).send('Comprobante no encontrado');
      return;
    }
    res.type(ticket.receipt_mime_type).send(ticket.receipt_data);
  } catch (error) {
    next(error);
  }
});

app.post('/admin/tickets/:id/approve', requireDb, adminAuth, async (req, res, next) => {
  try {
    await pool.query(
      `UPDATE tickets
       SET status = 'approved',
           ticket_number = COALESCE(ticket_number, 'MR-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(id::TEXT, 5, '0')),
           approved_at = NOW(),
           rejected_at = NULL,
           admin_note = NULL
       WHERE id = $1`,
      [req.params.id]
    );
    res.redirect('/admin');
  } catch (error) {
    next(error);
  }
});

app.post('/admin/tickets/:id/reject', requireDb, adminAuth, async (req, res, next) => {
  try {
    const adminNote = String(req.body.admin_note || '').trim().slice(0, 240);
    await pool.query(
      `UPDATE tickets
       SET status = 'rejected',
           rejected_at = NOW(),
           approved_at = NULL,
           admin_note = $2
       WHERE id = $1`,
      [req.params.id, adminNote || 'Comprobante observado. Por favor sube uno nuevo.']
    );
    res.redirect('/admin');
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).send(page('Error', `
    <main class="shell compact">
      <section class="notice">
        <h1>No se pudo completar la accion</h1>
        <p>${escapeHtml(error.message || 'Error interno')}</p>
      </section>
    </main>
  `));
});

ensureSchema()
  .then(() => {
    app.listen(port, () => {
      console.log(`Mi Refugio tickets running on ${baseUrl}`);
    });
  })
  .catch((error) => {
    console.error('No se pudo preparar la base de datos', error);
    process.exit(1);
  });
