# Mi Refugio SC Tickets

Sistema Node.js + PostgreSQL para vender tickets virtuales solidarios.

## Flujo

- El usuario registra nombre, WhatsApp y correo opcional.
- El usuario crea una contraseña, guardada como hash.
- El telefono usa selector de pais con deteccion inicial por IP y cambio manual.
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
   - `PAYMENT_QR_URL` opcional, solo como respaldo si aun no subiste QR desde admin
4. Start command: `npm start`

## QR de pago

El flujo principal es subirlo desde el panel admin:

1. Entrar a `/admin`.
2. Ir a la seccion "Imagen de pago".
3. Subir una imagen JPG, PNG o WEBP.

La imagen queda guardada en PostgreSQL, asi funciona en Railway sin subir archivos al repo.

Como respaldo tecnico tambien se puede usar `PAYMENT_QR_URL` o un archivo local `public/payment-qr.png`.

## Admin

Ruta: `/admin`

Usa autenticacion basica del navegador. El usuario puede ser cualquier texto; la clave es `ADMIN_PASSWORD`.
