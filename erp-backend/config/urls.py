from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    # Esta es la ruta para entrar al panel de administrador de Django
    path('admin/', admin.site.urls),
    
    # Esta línea "conecta" el portero principal con las rutas de nuestra aplicación "nucleo"
    path('', include('nucleo.urls')), 
]
