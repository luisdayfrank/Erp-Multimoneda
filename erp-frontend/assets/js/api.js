// assets/js/api.js
const BASE_URL = 'http://127.0.0.1:8000/api/v1';

async function refreshAccessToken() {
    const refresh = localStorage.getItem('refresh_token');
    if (!refresh) throw new Error('No hay refresh_token. Inicia sesión de nuevo.');

    const resp = await fetch(`${BASE_URL}/token/refresh/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ refresh }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.access) {
        const err = data && typeof data === 'object' ? data : { detail: 'No se pudo refrescar el token.' };
        throw err;
    }

    localStorage.setItem('access_token', data.access);
    return data.access;
}

async function apiFetch(endpoint, method = 'GET', body = null, _retried = false) {
    console.log(`🚀 Realizando petición: ${method} ${endpoint}`)
    const token = localStorage.getItem('access_token');
    
    if (token) {
        console.log("✅ Token encontrado en localStorage.");
    } else {
        console.warn("🚨 No se encontró token en localStorage. La petición irá sin autenticación.");
    }

    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const config = {
        method: method,
        headers: headers,
    };

    if (body) {
        config.body = JSON.stringify(body);
    }

    try {
        const url = endpoint.startsWith('/') ? `${BASE_URL}${endpoint}` : `${BASE_URL}/${endpoint}`;
        
        console.log("Enviando a:", url);
        console.log("Con cabeceras:", headers);

        const response = await fetch(url, config);

        // A veces 204/empty; evitamos crash de .json()
        const text = await response.text();
        const data = text ? JSON.parse(text) : {};

        if (!response.ok) {
            console.error("❌ Error en la respuesta de la API:", data);

            // Si expiró el access_token, intentamos refrescar y reintentar 1 vez
            const tokenNotValid =
                response.status === 401 &&
                data &&
                typeof data === 'object' &&
                (data.code === 'token_not_valid' || String(data.detail || '').toLowerCase().includes('token'));

            if (tokenNotValid && !_retried) {
                try {
                    const newAccess = await refreshAccessToken();
                    console.warn("🔁 Token refrescado. Reintentando petición...");
                    // Reintenta con token nuevo
                    localStorage.setItem('access_token', newAccess);
                    return await apiFetch(endpoint, method, body, true);
                } catch (refreshErr) {
                    // Si no se puede refrescar, limpiamos y forzamos login
                    localStorage.removeItem('access_token');
                    localStorage.removeItem('refresh_token');
                    
                    // >>> NUEVO: REDIRECCIÓN FORZADA POR SEGURIDAD <<<
                    alert('Tu sesión expiró por inactividad. Serás redirigido al inicio de sesión.');
                    window.location.href = 'index.html'; 
                    
                    throw Object.assign(refreshErr, { messageForUser: 'Tu sesión expiró. Inicia sesión nuevamente.' });
                }
            }

            throw data; // Lanzamos el error para que sea capturado por el .catch()
        }

        console.log("✅ Respuesta exitosa de la API:", data);
        return data;

    } catch (error) {
        console.error("💥 Excepción catastrófica en apiFetch:", error);
        // Si es respuesta de la API con errores de validación (400, 401, etc.)
        if (error && typeof error === 'object') {
            if (error.detail) throw error;
            // Errores de validación DRF suelen venir en el mismo objeto (ej. { campo: ["mensaje"] })
            const msg = typeof error.detail !== 'undefined' ? error.detail : (error.error || JSON.stringify(error));
            throw Object.assign(error, { messageForUser: msg });
        }
        throw new Error('Error de red o conexión rechazada. Revisa la URL de la API y que el servidor esté encendido.');
    }
}