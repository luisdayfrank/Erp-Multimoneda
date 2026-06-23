
from rest_framework import permissions

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
        
        # === RADAR: IMPRIME EN LA CONSOLA NEGRA ===
        print("\n" + "="*40)
        print(f"🔑 INTENTO DE ACCESO A LA CAJA")
        print(f"👤 Usuario: {request.user.username}")
        print(f"🛡️ Rol leído de la BD: '{rol_actual}'")
        print(f"👑 ¿Es Superusuario?: {getattr(request.user, 'is_superuser', False)}")
        print("="*40 + "\n")
        
        if getattr(request.user, 'is_superuser', False):
            return True
            
        return rol_actual in ['CAJERO', 'ADMINISTRADOR', 'ADMIN', 'GERENTE', 'CAJA']
