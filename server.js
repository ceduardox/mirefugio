require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;
const baseUrl = (process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, '');
const ticketPriceLabel = process.env.TICKET_PRICE_LABEL || 'Bs 20';
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
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  ${body}
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
      <section class="purchase-panel">
        <div class="brand-block">
          <img class="brand-mark large" src="/logo" alt="Mi Refugio SC">
          <p class="eyebrow">Ticket solidario virtual</p>
          <h1>Compra tu ticket para apoyar a los perritos de Mi Refugio SC</h1>
          <p class="lead">Completa tus datos, paga con QR y sube tu comprobante. Cuando el admin lo apruebe, tu ticket quedara disponible con un enlace para compartir.</p>
          <div class="quick-facts">
            <span>${escapeHtml(ticketPriceLabel)}</span>
            <span>Pago por QR</span>
            <span>Ticket digital unico</span>
          </div>
        </div>
        <form class="form-card" method="post" action="/tickets">
          <label>Nombre completo
            <input name="buyer_name" autocomplete="name" placeholder="Ej. Maria Fernandez" required>
          </label>
          <label>WhatsApp
            <input name="whatsapp" inputmode="tel" autocomplete="tel" placeholder="Ej. +59170000000" required>
          </label>
          <label>Correo opcional
            <input name="email" type="email" autocomplete="email" placeholder="tu@email.com">
          </label>
          <button class="primary-btn" type="submit">Continuar al pago</button>
        </form>
      </section>
    </main>
  `));
});

app.post('/tickets', requireDb, async (req, res, next) => {
  try {
    const publicId = crypto.randomUUID();
    const buyerName = String(req.body.buyer_name || '').trim().slice(0, 120);
    const whatsapp = normalizeWhatsapp(req.body.whatsapp || '');
    const email = String(req.body.email || '').trim().slice(0, 160);
    const result = await pool.query(
      `INSERT INTO tickets (public_id, buyer_name, whatsapp, email)
       VALUES ($1, $2, $3, $4)
       RETURNING public_id`,
      [publicId, buyerName, whatsapp, email]
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
      <section class="content-card">
        <div class="section-title">
          <div>
            <p class="eyebrow">Paso 1</p>
            <h2>Paga con QR</h2>
          </div>
          <a class="ghost-btn" href="/payment-qr/download">Descargar QR</a>
        </div>
        <button class="qr-frame" type="button" data-open-qr>
          <img src="/payment-qr" alt="QR de pago Mi Refugio SC">
        </button>
        <form class="upload-box" method="post" action="/t/${ticket.public_id}/receipt" enctype="multipart/form-data">
          <p class="eyebrow">Paso 2</p>
          <h2>Sube tu comprobante</h2>
          <input type="file" name="receipt" accept="image/png,image/jpeg,image/webp,application/pdf" required>
          <button class="primary-btn" type="submit">Enviar comprobante a revision</button>
        </form>
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
        </section>
        ${approvedTicket}
        ${uploadForm}
      </main>
      <dialog class="qr-modal" data-qr-modal>
        <button class="icon-btn" type="button" data-close-qr aria-label="Cerrar">x</button>
        <img src="/payment-qr" alt="QR de pago Mi Refugio SC ampliado">
        <a class="primary-btn" href="/payment-qr/download">Descargar QR</a>
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
    const { rows } = await pool.query('SELECT id, public_id, ticket_number, buyer_name, whatsapp, status, created_at, receipt_uploaded_at FROM tickets ORDER BY created_at DESC LIMIT 200');
    const items = rows.map((ticket) => `
      <article class="admin-row ${ticket.status}">
        <div>
          <strong>${escapeHtml(ticket.buyer_name || 'Sin nombre')}</strong>
          <span>${escapeHtml(ticket.whatsapp || '')}</span>
          <small>${escapeHtml(statusCopy(ticket.status))} · ${new Date(ticket.created_at).toLocaleString('es-BO')}</small>
        </div>
        <div class="admin-actions">
          <a class="ghost-btn" href="/t/${ticket.public_id}" target="_blank">Ver</a>
          ${ticket.receipt_uploaded_at ? `<a class="ghost-btn" href="/admin/tickets/${ticket.id}/receipt" target="_blank">Comprobante</a>` : ''}
          <form method="post" action="/admin/tickets/${ticket.id}/approve"><button class="primary-btn" type="submit">Aprobar</button></form>
          <form method="post" action="/admin/tickets/${ticket.id}/reject"><button class="danger-btn" type="submit">Observar</button></form>
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
            <form class="upload-box" method="post" action="/admin/payment-qr" enctype="multipart/form-data">
              <label>Subir o reemplazar QR
                <input type="file" name="payment_qr" accept="image/png,image/jpeg,image/webp" required>
              </label>
              <button class="primary-btn" type="submit">Guardar QR de pago</button>
            </form>
          </div>
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
           rejected_at = NULL
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
    await pool.query(
      `UPDATE tickets
       SET status = 'rejected',
           rejected_at = NOW(),
           approved_at = NULL
       WHERE id = $1`,
      [req.params.id]
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
