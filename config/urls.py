from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.http import FileResponse, Http404
from pathlib import Path
import mimetypes
from django.conf.urls.static import static
# Carpeta donde vive tu frontend (HTML, JS, CSS)
FRONTEND_DIR = Path(settings.BASE_DIR) / 'frontend'

def serve_frontend(request, path=''):
    """
    Sirve archivos estáticos del frontend.
    Fallback a index.html para rutas desconocidas (SPA behavior).
    No interfiere con /api/, /admin/, /static/ ni /media/.
    """
    # Protección: nunca servir frontend si la petición va a API, Admin, Static o Media
    if request.path.startswith(('/api/', '/admin/', '/static/', '/media/')):
        raise Http404()

    # Sanitizar path y prevenir directory traversal
    target = (FRONTEND_DIR / path).resolve()
    try:
        target.relative_to(FRONTEND_DIR.resolve())
    except ValueError:
        raise Http404()

    # Si el archivo existe, servirlo directamente
    if target.is_file():
        content_type, _ = mimetypes.guess_type(str(target))
        return FileResponse(target.open('rb'), content_type=content_type)

    # Si no existe el archivo pero existe index.html, servir index.html (SPA routing)
    index_file = FRONTEND_DIR / 'index.html'
    if index_file.is_file():
        return FileResponse(index_file.open('rb'), content_type='text/html')

    raise Http404()


urlpatterns = [
    path('admin/', admin.site.urls),
    path('', include('nucleo.urls')),  # Tu API vive aquí (api/v1/...)
]

# En desarrollo: cualquier ruta no capturada por admin o nucleo va al frontend
##if settings.DEBUG:
##    urlpatterns += [
##        re_path(r'^(?P<path>.*)$', serve_frontend),
##    ]
if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.BASE_DIR / 'staticfiles')
    # Si usas archivos subidos (opcional):
    # urlpatterns += static(settings.MEDIA_URL, document_root=settings.BASE_DIR / 'media')
    
    urlpatterns += [
        re_path(r'^(?P<path>.*)$', serve_frontend),
    ]
