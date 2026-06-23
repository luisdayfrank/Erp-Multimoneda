from datetime import timedelta

# Configuración global de DRF
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    # Opcional: Si quieres que toda la API esté bloqueada por defecto
    # 'DEFAULT_PERMISSION_CLASSES': (
    #     'rest_framework.permissions.IsAuthenticated',
    # )
}

# Configuración de JWT
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(days=1), # Para desarrollo lo dejamos en 1 día. En producción suele ser de 15 a 60 minutos.
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': False,
    'ALGORITHM': 'HS256',
    'SIGNING_KEY': SECRET_KEY,
    'BLACKLIST_AFTER_ROTATION': True,
    'AUTH_HEADER_TYPES': ('Bearer',),
    'USER_ID_FIELD': 'id',
    'USER_ID_CLAIM': 'user_id',
}


DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.mysql', # Usamos el motor de MySQL para MariaDB
        'NAME': 'erp_bimonetario',            # El nombre exacto que creaste en phpMyAdmin
        'USER': 'root',                       # Usuario por defecto de XAMPP
        'PASSWORD': '',                       # XAMPP no tiene contraseña por defecto
        'HOST': 'localhost',                  # Tu propia computadora
        'PORT': '3306',                       # El puerto por defecto de MariaDB
        'OPTIONS': {
            'init_command': "SET sql_mode='STRICT_TRANS_TABLES'",
        }
    }
}

AUTH_USER_MODEL = 'nucleo.Usuario'

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    
    # --- LIBRERÍAS NUEVAS QUE INSTALAMOS ---
    'rest_framework',
    'rest_framework_simplejwt',
    'corsheaders',
    
    # --- NUESTRA APLICACIÓN ---
    'nucleo',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware', # <-- AÑADIR ESTA LÍNEA AQUÍ
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

CORS_ALLOW_ALL_ORIGINS = True
