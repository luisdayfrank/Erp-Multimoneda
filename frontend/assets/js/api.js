const BASE_URL = '/api/v1';

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

    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    } else {
        console.warn("🚨 No se encontró token en localStorage. La petición irá sin autenticación.");
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
        // FIX SEG-1: NUNCA imprimir las cabeceras en consola. Antes se hacía
        // console.log("Con cabeceras:", headers) y el token Bearer (la sesión
        // completa del usuario) quedaba a la vista de cualquiera que abriera la
        // consola del navegador, una extensión o una grabación de pantalla.
        console.log("Con cabeceras:", { ...headers, Authorization: headers.Authorization ? 'Bearer ***oculto***' : '(sin token)' });

        const response = await fetch(url, config);

        // A veces 204/empty; evitamos crash de .json()
        const text = await response.text();
        // FIX SEG-2: si el servidor devuelve HTML (página de error 500, proxy caído)
        // JSON.parse reventaba y el usuario veía "Error de red", que lo empujaba a
        // reintentar a mano una venta que SÍ se había procesado.
        let data;
        try {
            data = text ? JSON.parse(text) : {};
        } catch (parseErr) {
            data = {
                detail: 'El servidor devolvió una respuesta que no es JSON (¿error 500 o proxy caído?).',
                raw: String(text).slice(0, 300)
            };
        }

        if (!response.ok) {
            console.error("❌ Error en la respuesta de la API:", data);

            // Si expiró el access_token, intentamos refrescar y reintentar 1 vez.
            // ESTO ES SEGURO: una petición con token inválido la rechaza la capa de
            // autenticación ANTES de que la vista la procese, así que reintentarla
            // nunca puede duplicar una venta.
            const tokenNotValid =
                response.status === 401 &&
                data &&
                typeof data === 'object' &&
                (data.code === 'token_not_valid' || String(data.detail || '').toLowerCase().includes('token'));

            if (tokenNotValid && !_retried) {
                try {
                    const newAccess = await refreshAccessToken();
                    console.warn("🔁 Token refrescado. Reintentando petición...");
                    localStorage.setItem('access_token', newAccess);
                    return await apiFetch(endpoint, method, body, true);
                } catch (refreshErr) {
                    localStorage.removeItem('access_token');
                    localStorage.removeItem('refresh_token');

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
        console.error("💥 Excepción en apiFetch:", error && error.message ? error.message : error);
        // Si es respuesta de la API con errores de validación (400, 401, etc.)
        if (error && typeof error === 'object') {
            if (error.detail) throw error;
            const msg = typeof error.detail !== 'undefined' ? error.detail : (error.error || JSON.stringify(error));
            throw Object.assign(error, { messageForUser: msg });
        }
        throw new Error('Error de red o conexión rechazada. Revisa la URL de la API y que el servidor esté encendido.');
    }
}
