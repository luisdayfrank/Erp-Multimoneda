// assets/js/auth.js

// ==============================================================================
// 1. VERIFICACIÓN INICIAL
// ==============================================================================
document.addEventListener('DOMContentLoaded', () => {
    // Si el usuario ya tiene un token guardado (ya inició sesión antes y no ha cerrado),
    // lo enviamos directamente al Punto de Venta para que no tenga que poner la clave de nuevo.
    const tokenGuardado = localStorage.getItem('access_token');
    if (tokenGuardado) {
        window.location.href = 'pos.html';
    }
});

// ==============================================================================
// 2. PROCESAMIENTO DEL FORMULARIO DE LOGIN
// ==============================================================================
document.getElementById('loginForm').addEventListener('submit', async function(event) {
    event.preventDefault(); // Evitamos que la página recargue al hacer submit

    // Capturamos los datos
    const user = document.getElementById('username').value.trim();
    const pass = document.getElementById('password').value;
    const divError = document.getElementById('mensajeError');

    // Limpiamos errores anteriores visualmente
    divError.classList.add('d-none');
    divError.innerText = '';

    try {
        // Apuntamos al endpoint de SimpleJWT en Django
        const response = await fetch('http://127.0.0.1:8000/api/v1/token/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username: user,
                password: pass
            })
        });

        const data = await response.json();

        // Si Django rechaza las credenciales (Status 400 o 401)
        if (!response.ok) {
            // DRF SimpleJWT suele devolver el mensaje en la propiedad "detail"
            throw new Error(data.detail || 'Usuario o contraseña incorrectos.');
        }

        // ¡ÉXITO! AQUÍ ESTÁ LA CORRECCIÓN CRÍTICA:
        // Guardamos las llaves en la "bóveda" del navegador para que no se pierdan.
        localStorage.setItem('access_token', data.access);
        localStorage.setItem('refresh_token', data.refresh);

        // ¡Bienvenido! Lo redirigimos a la pantalla principal de la caja
        window.location.href = 'pos.html';

    } catch (error) {
        // Mostramos la alerta roja en la pantalla
        divError.innerText = error.message;
        divError.classList.remove('d-none');
    }
});