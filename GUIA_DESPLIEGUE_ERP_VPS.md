# 🚀 Guía de Despliegue ERP Django en VPS Interserver.net
## Desde PowerShell → SSH → Producción con Git Pull

---

## 📋 RESUMEN DEL STACK

| Componente | Versión/Recomendación |
|------------|----------------------|
| SO VPS | Ubuntu 22.04 LTS (o Debian 12) |
| Python | 3.10+ |
| Servidor App | Gunicorn (WSGI) |
| Proxy Inverso | Nginx |
| Base de Datos | MariaDB 10.6+ |
| Static Files | WhiteNoise + Nginx |
| SSL | Let's Encrypt (Certbot) |
| Control | Systemd + Git |

---

## FASE 1: CONEXIÓN INICIAL AL VPS

### 1.1 Abrir PowerShell (Windows) y conectarte

```powershell
# Reemplaza con tu IP real de Interserver
ssh root@TU_IP_DEL_VPS

# Si te pide confirmación, escribe: yes
# Ingresa la contraseña que te dio Interserver
```

### 1.2 Actualizar el sistema

```bash
apt update && apt upgrade -y
```

### 1.3 Crear usuario no-root (obligatorio para seguridad)

```bash
adduser deployer
usermod -aG sudo deployer
```

### 1.4 Configurar acceso SSH con llave (opcional pero recomendado)

En **PowerShell local** (NO en el VPS):

```powershell
# Generar llave SSH (si no tienes)
ssh-keygen -t ed25519 -C "tu-email@ejemplo.com"

# Copiar llave pública al VPS
ssh-copy-id deployer@TU_IP_DEL_VPS
```

En el **VPS**, desactivar login por password:

```bash
nano /etc/ssh/sshd_config
```

Busca y modifica:
```
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
```

```bash
systemctl restart sshd
```

Desde ahora entra con:
```powershell
ssh deployer@TU_IP_DEL_VPS
```

---

## FASE 2: INSTALAR DEPENDENCIAS DEL SISTEMA

### 2.1 Instalar paquetes esenciales

```bash
sudo apt install -y     python3-pip python3-venv python3-dev     build-essential libssl-dev libffi-dev     mariadb-server mariadb-client     libmysqlclient-dev pkg-config     nginx git curl     certbot python3-certbot-nginx
```

### 2.2 Verificar MariaDB

```bash
sudo systemctl status mariadb
sudo systemctl enable mariadb
```

### 2.3 Configurar MariaDB

```bash
sudo mysql_secure_installation
```

Responde:
- Switch to unix_socket: **N**
- Change root password: **Y** (crea una contraseña fuerte, GUÁRDALA)
- Remove anonymous users: **Y**
- Disallow root login remotely: **Y**
- Remove test database: **Y**
- Reload privilege tables: **Y**

### 2.4 Crear base de datos y usuario para el ERP

```bash
sudo mysql -u root -p
```

```sql
CREATE DATABASE erp_bimonetario CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'erp_user'@'localhost' IDENTIFIED BY 'TU_PASSWORD_FUERTE_AQUI';

GRANT ALL PRIVILEGES ON erp_bimonetario.* TO 'erp_user'@'localhost';

FLUSH PRIVILEGES;
EXIT;
```

---

## FASE 3: CLONAR PROYECTO DESDE GITHUB

### 3.1 Crear estructura de directorios

```bash
sudo mkdir -p /var/www
sudo chown deployer:deployer /var/www
cd /var/www
```

### 3.2 Clonar tu repositorio

```bash
git clone https://github.com/TU_USUARIO/TU_REPO.git erp
```

> Si tu repo es privado, usa SSH: `git clone git@github.com:TU_USUARIO/TU_REPO.git erp`

```bash
cd erp
```

### 3.3 Crear entorno virtual

```bash
python3 -m venv venv
source venv/bin/activate
```

### 3.4 Instalar dependencias Python

Crea un archivo `requirements.txt` si no lo tienes (en tu PC local o en el repo):

```bash
# En tu PC local, dentro del proyecto:
pip freeze > requirements.txt
# Súbelo a GitHub
```

En el VPS:

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

**Contenido mínimo de `requirements.txt`:**

```
Django>=4.2,<5.0
djangorestframework
djangorestframework-simplejwt
django-cors-headers
gunicorn
whitenoise
mysqlclient
openpyxl
python-dotenv
```

---

## FASE 4: CONFIGURAR DJANGO PARA PRODUCCIÓN

### 4.1 Crear archivo de variables de entorno

```bash
cd /var/www/erp
nano .env
```

**Contenido de `.env`:**

```env
DEBUG=False
SECRET_KEY=tu-clave-secreta-muy-larga-y-aleatoria-de-50-caracteres-o-mas
ALLOWED_HOSTS=tu-dominio.com,www.tu-dominio.com,TU_IP_DEL_VPS

DB_NAME=erp_bimonetario
DB_USER=erp_user
DB_PASSWORD=TU_PASSWORD_FUERTE_AQUI
DB_HOST=localhost
DB_PORT=3306

TIME_ZONE=America/Caracas
LANGUAGE_CODE=es-ve
```

Genera una SECRET_KEY nueva:

```bash
python -c "import secrets; print(secrets.token_urlsafe(50))"
```

### 4.2 Modificar `config/settings.py` para producción

Edita `/var/www/erp/config/settings.py` y realiza estos cambios:

```python
import os
from dotenv import load_dotenv
from pathlib import Path

# Cargar variables de entorno
load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

# ======================
# SEGURIDAD
# ======================
SECRET_KEY = os.getenv('SECRET_KEY')
DEBUG = os.getenv('DEBUG', 'False').lower() == 'true'
ALLOWED_HOSTS = os.getenv('ALLOWED_HOSTS', '').split(',')

# ======================
# APLICACIONES
# ======================
INSTALLED_APPS = [
    'whitenoise.runserver_nostatic',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'rest_framework_simplejwt',
    'corsheaders',
    'nucleo',
]

# ======================
# MIDDLEWARE (WhiteNoise primero)
# ======================
MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

# ======================
# BASE DE DATOS (MariaDB)
# ======================
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.mysql',
        'NAME': os.getenv('DB_NAME'),
        'USER': os.getenv('DB_USER'),
        'PASSWORD': os.getenv('DB_PASSWORD'),
        'HOST': os.getenv('DB_HOST'),
        'PORT': os.getenv('DB_PORT', '3306'),
        'OPTIONS': {
            'init_command': "SET sql_mode='STRICT_TRANS_TABLES'",
        }
    }
}

# ======================
# CORS (Restringir en producción)
# ======================
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS = [
    "https://tu-dominio.com",
    "https://www.tu-dominio.com",
]
CORS_ALLOW_CREDENTIALS = True

# ======================
# STATIC FILES (WhiteNoise)
# ======================
STATIC_URL = 'static/'
STATICFILES_DIRS = [BASE_DIR / 'frontend']
STATIC_ROOT = BASE_DIR / 'staticfiles'
WHITENOISE_ROOT = BASE_DIR / 'frontend'

# WhiteNoise compresión y caching
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

# ======================
# MEDIA FILES (si usas uploads)
# ======================
MEDIA_URL = 'media/'
MEDIA_ROOT = BASE_DIR / 'media'

# ======================
# INTERNACIONALIZACIÓN
# ======================
LANGUAGE_CODE = os.getenv('LANGUAGE_CODE', 'es-ve')
TIME_ZONE = os.getenv('TIME_ZONE', 'America/Caracas')
USE_I18N = True
USE_TZ = True

# ======================
# REST FRAMEWORK
# ======================
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
}

# ======================
# JWT
# ======================
from datetime import timedelta
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=30),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': False,
    'ALGORITHM': 'HS256',
    'SIGNING_KEY': SECRET_KEY,
    'BLACKLIST_AFTER_ROTATION': True,
    'AUTH_HEADER_TYPES': ('Bearer',),
}

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
AUTH_USER_MODEL = 'nucleo.Usuario'
```

### 4.3 Aplicar migraciones y crear superusuario

```bash
cd /var/www/erp
source venv/bin/activate

python manage.py migrate
python manage.py collectstatic --noinput
python manage.py createsuperuser
```

### 4.4 Verificar que levanta

```bash
python manage.py check --deploy
```

> Corrige cualquier warning de seguridad que aparezca.

---

## FASE 5: CONFIGURAR GUNICORN + SYSTEMD

### 5.1 Crear archivo de servicio systemd

```bash
sudo nano /etc/systemd/system/erp.gunicorn.service
```

```ini
[Unit]
Description=ERP Django Gunicorn Daemon
After=network.target

[Service]
User=deployer
Group=deployer
WorkingDirectory=/var/www/erp
Environment="PATH=/var/www/erp/venv/bin"
EnvironmentFile=/var/www/erp/.env
ExecStart=/var/www/erp/venv/bin/gunicorn     --access-logfile /var/www/erp/logs/gunicorn-access.log     --error-logfile /var/www/erp/logs/gunicorn-error.log     --workers 3     --bind unix:/var/www/erp/erp.sock     config.wsgi:application

[Install]
WantedBy=multi-user.target
```

### 5.2 Crear carpeta de logs

```bash
mkdir -p /var/www/erp/logs
```

### 5.3 Activar y arrancar el servicio

```bash
sudo systemctl daemon-reload
sudo systemctl start erp.gunicorn
sudo systemctl enable erp.gunicorn
sudo systemctl status erp.gunicorn
```

Si hay errores, revisa:
```bash
sudo journalctl -u erp.gunicorn -f
```

---

## FASE 6: CONFIGURAR NGINX

### 6.1 Crear configuración del sitio

```bash
sudo nano /etc/nginx/sites-available/erp
```

```nginx
server {
    listen 80;
    server_name tu-dominio.com www.tu-dominio.com TU_IP_DEL_VPS;

    client_max_body_size 20M;

    location = /favicon.ico { access_log off; log_not_found off; }

    location /static/ {
        alias /var/www/erp/staticfiles/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location /media/ {
        alias /var/www/erp/media/;
    }

    location / {
        include proxy_params;
        proxy_pass http://unix:/var/www/erp/erp.sock;
    }
}
```

### 6.2 Activar sitio

```bash
sudo ln -s /etc/nginx/sites-available/erp /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl enable nginx
```

### 6.3 Ajustar permisos

```bash
sudo chown -R deployer:deployer /var/www/erp
sudo chmod -R 755 /var/www/erp
```

---

## FASE 7: SSL CON LET'S ENCRYPT (Opcional pero recomendado)

```bash
sudo certbot --nginx -d tu-dominio.com -d www.tu-dominio.com
```

Selecciona:
- Redirect HTTP to HTTPS: **2** (Redirect)

Certbot renovará automáticamente.

---

## FASE 8: FLUJO DE ACTUALIZACIÓN CON GIT PULL

Este es el flujo que usarás SIEMPRE que actualices código en tu PC y quieras subirlo al VPS.

### 8.1 En tu PC local (PowerShell)

```powershell
# 1. Asegúrate de estar en la rama main
cd D:
uevoot monitorot_monitor-main7   # o la ruta de tu ERP

# 2. Verifica cambios
git status

# 3. Agrega, commitea y pushea
git add .
git commit -m "feat: descripcion del cambio"
git push origin main
```

### 8.2 En el VPS (SSH)

```bash
cd /var/www/erp

# 1. Pull de los cambios
git pull origin main

# 2. Activar entorno
source venv/bin/activate

# 3. Instalar nuevas dependencias (si agregaste librerías)
pip install -r requirements.txt

# 4. Aplicar migraciones (si cambiaste models)
python manage.py migrate

# 5. Recolectar static files (si cambiaste frontend)
python manage.py collectstatic --noinput

# 6. Reiniciar Gunicorn
sudo systemctl restart erp.gunicorn

# 7. Verificar estado
sudo systemctl status erp.gunicorn
```

### 8.3 Script de despliegue automático (Opcional)

Crea un script para hacerlo en un solo comando:

```bash
nano /var/www/erp/deploy.sh
```

```bash
#!/bin/bash
set -e

echo "🚀 Iniciando despliegue..."

cd /var/www/erp

echo "📥 Git Pull..."
git pull origin main

echo "📦 Instalando dependencias..."
source venv/bin/activate
pip install -r requirements.txt

echo "🗄️  Migraciones..."
python manage.py migrate

echo "📁 Collect Static..."
python manage.py collectstatic --noinput

echo "🔄 Reiniciando servicio..."
sudo systemctl restart erp.gunicorn

echo "✅ Despliegue completado!"
sudo systemctl status erp.gunicorn --no-pager
```

```bash
chmod +x /var/www/erp/deploy.sh
```

Uso:
```bash
./deploy.sh
```

---

## FASE 9: BACKUP DE BASE DE DATOS

### 9.1 Backup manual

```bash
# Backup
mysqldump -u erp_user -p erp_bimonetario > backup_$(date +%Y%m%d_%H%M).sql

# Restaurar
mysql -u erp_user -p erp_bimonetario < backup_20260101_1200.sql
```

### 9.2 Backup automático diario (cron)

```bash
crontab -e
```

Agrega:
```
# Backup diario a las 2 AM
0 2 * * * mysqldump -u erp_user -p'TU_PASSWORD' erp_bimonetario > /var/backups/erp_$(date +\%Y\%m\%d).sql

# Borrar backups de más de 7 días
0 3 * * * find /var/backups -name "erp_*.sql" -mtime +7 -delete
```

Crear directorio:
```bash
sudo mkdir -p /var/backups
```

---

## FASE 10: COMANDOS ÚTILES PARA SUPERVISAR

```bash
# Ver logs de la app en tiempo real
sudo journalctl -u erp.gunicorn -f

# Ver logs de Nginx
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log

# Ver logs de Gunicorn
tail -f /var/www/erp/logs/gunicorn-error.log

# Estado de servicios
sudo systemctl status erp.gunicorn
sudo systemctl status nginx
sudo systemctl status mariadb

# Reiniciar servicios
sudo systemctl restart erp.gunicorn
sudo systemctl restart nginx

# Ver procesos Python
ps aux | grep gunicorn

# Espacio en disco
df -h

# Ver conexiones activas
ss -tlnp | grep :80
ss -tlnp | grep :443
```

---

## ⚠️ CHECKLIST PRE-DESPLEGUE

- [ ] Dominio apuntando a la IP del VPS (o usar IP directa)
- [ ] Firewall abierto: puertos 22 (SSH), 80 (HTTP), 443 (HTTPS)
- [ ] `.env` creado con SECRET_KEY fuerte y única
- [ ] `DEBUG=False` en producción
- [ ] `ALLOWED_HOSTS` configurado con tu dominio/IP
- [ ] Base de datos creada y usuario con permisos
- [ ] Migraciones aplicadas
- [ ] Superusuario creado
- [ ] `collectstatic` ejecutado sin errores
- [ ] Servicio systemd activo y funcionando
- [ ] Nginx sirviendo sin errores (`nginx -t`)
- [ ] SSL configurado (si tienes dominio)
- [ ] Git remote configurado correctamente

---

## 🔄 RESUMEN DEL FLUJO DIARIO

```
[PC Local]        [GitHub]          [VPS]
   |                  |                |
   |-- git push ----->|                |
   |                  |                |
   |                  |<-- git pull ---|
   |                  |                |
   |                  |         [migrate]
   |                  |         [collectstatic]
   |                  |         [restart gunicorn]
   |                  |                |
```

**Comando mágico en VPS después de cada actualización:**

```bash
cd /var/www/erp && git pull && source venv/bin/activate && pip install -r requirements.txt && python manage.py migrate && python manage.py collectstatic --noinput && sudo systemctl restart erp.gunicorn && echo "✅ Listo"
```

---

*Documento generado para despliegue en Interserver.net VPS*
*Stack: Django + DRF + MariaDB + Nginx + Gunicorn + WhiteNoise*
