
import logging

from rest_framework import permissions

# P16: los diagnósticos van por logging, nunca por print(). Un print con
# emojis puede lanzar UnicodeEncodeError en consolas cp1252 (Windows) y
# convertir una petición válida en un 500.
logger = logging.getLogger(__name__)


class IsGerenteOrAdmin(permissions.BasePermission):
    """
    Permite el acceso únicamente a usuarios con rol de GERENTE o ADMIN.
    """
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
            
        if getattr(request.user, 'is_superuser', False):
            return True
            
        rol = str(getattr(request.user, 'rol', '')).upper()
        return rol in ['ADMINISTRADOR', 'ADMIN', 'GERENTE']


class IsCajeroOrSuperior(permissions.BasePermission):
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
            
        rol_actual = str(getattr(request.user, 'rol', '')).upper()

        # Diagnóstico de acceso a caja (sin datos sensibles y sin emojis).
        # Queda en nivel DEBUG: no ensucia la salida ni puede romper la petición.
        logger.debug(
            "Acceso a caja: usuario=%s rol=%s superuser=%s",
            request.user.username,
            rol_actual,
            getattr(request.user, 'is_superuser', False),
        )
        
        if getattr(request.user, 'is_superuser', False):
            return True
            
        return rol_actual in ['CAJERO', 'ADMINISTRADOR', 'ADMIN', 'GERENTE', 'CAJA']
