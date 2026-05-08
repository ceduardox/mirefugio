# Mi Refugio SC Tickets

Sistema Node.js + PostgreSQL para vender tickets virtuales solidarios.

## Flujo

- El usuario registra nombre, WhatsApp y correo opcional.
- Ve el QR de pago, puede ampliarlo o descargarlo.
- Sube el comprobante de pago.
- El admin revisa y aprueba.
- Al aprobarse se genera un numero unico de ticket y un enlace publico para compartir.

## Configuracion local

```bash
npm install
copy .env.example .env
npm run dev
```

Configura `DATABASE_URL` antes de iniciar. La app crea la tabla automaticamente usando `schema.sql`.

## Railway

1. Crear un servicio desde este repositorio.
2. Agregar PostgreSQL en Railway.
3. Definir variables:
   - `DATABASE_URL`
   - `ADMIN_PASSWORD`
   - `PUBLIC_BASE_URL`
   - `TICKET_PRICE_LABEL`
   - `PAYMENT_QR_URL` opcional
4. Start command: `npm start`

## QR de pago

Opciones:

- Subir una imagen real como `public/payment-qr.png`, `public/payment-qr.jpg` o `public/payment-qr.jpeg`.
- Usar `PAYMENT_QR_URL` si el QR esta alojado fuera de la app.

## Admin

Ruta: `/admin`

Usa autenticacion basica del navegador. El usuario puede ser cualquier texto; la clave es `ADMIN_PASSWORD`.
