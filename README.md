# SoloVideoClub Control — MVP funcional

Primera versión real del panel de administración para Emby y Jellyfin.

## Funciones incluidas

- Login seguro con roles.
- Superadministrador y reseller.
- El reseller solo ve sus propios usuarios.
- Sistema básico de créditos.
- Dashboard.
- Alta, edición, suspensión y eliminación de usuarios.
- Plan, caducidad, dispositivos, streams y bibliotecas.
- Gestión de resellers.
- Configuración inicial de servidores Emby/Jellyfin.
- Registro de actividad.
- Base de datos SQLite persistente.
- Docker Compose para instalarlo fácilmente.

## Accesos iniciales

Administrador:
- Usuario: `admin`
- Contraseña: `Admin123!`

Reseller de prueba:
- Usuario: `reseller1`
- Contraseña: `Reseller123!`

Cambia estas contraseñas antes de usarlo públicamente.

## Ejecutar en Windows sin Docker

1. Instala Node.js 22.
2. Abre CMD dentro de esta carpeta.
3. Ejecuta:

```bash
npm install
npm start
```

4. Abre:

```text
http://localhost:3000
```

## Ejecutar con Docker / TrueNAS

Desde la carpeta del proyecto:

```bash
docker compose up -d --build
```

Después abre:

```text
http://IP-DE-TU-TRUENAS:3000
```

## Estado actual

Esta versión ya guarda usuarios reales en su propia base de datos, aplica permisos por rol y permite trabajar con resellers.

La creación directa de usuarios dentro de Emby y Jellyfin todavía está preparada como siguiente integración. Para activarla harán falta:

- URL local de Emby.
- API key de Emby.
- URL local de Jellyfin.
- API key de Jellyfin.
- Nombres o IDs de las bibliotecas.
