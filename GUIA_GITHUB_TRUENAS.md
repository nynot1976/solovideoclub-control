# Publicar SoloVideoClub Control en GitHub

1. Crea un repositorio público llamado `solovideoclub-control`.
2. Sube todos los archivos de esta carpeta, incluida `.github`.
3. Espera a que termine `Actions > Build and publish Docker image`.
4. Abre la sección `Packages` del repositorio y confirma que existe la imagen.
5. En TrueNAS, usa `Install via YAML` y pega el contenido de `truenas-compose.yml`.
6. Sustituye `TU_USUARIO` por tu usuario real de GitHub en minúsculas.
7. Abre `http://IP_DE_TRUENAS:3000`.

Acceso inicial:
- Administrador: admin / Admin123!
- Reseller: reseller1 / Reseller123!

Cambia las contraseñas antes de exponer el panel a Internet.
