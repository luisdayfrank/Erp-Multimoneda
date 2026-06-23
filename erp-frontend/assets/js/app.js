document.getElementById('loginForm').addEventListener('submit', function(event) {
    event.preventDefault(); // Evita que la página recargue

    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;

    // Hablamos con la API de Django que construimos
    fetch('http://127.0.0.1:8000/api/v1/token/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            username: user,
            password: pass
        })
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Usuario o contraseña incorrectos');
        }
        return response.json();
    })
    .then(data => {
        // ¡Magia! Guardamos el token en la memoria fuerte del navegador
        localStorage.setItem('access_token', data.access);
        localStorage.setItem('refresh_token', data.refresh);
        
        // Redirigimos al cajero a la pantalla de ventas
        window.location.href = 'pos.html'; 
    })
    .catch(error => {
        document.getElementById('mensajeError').innerText = error.message;
    });
});
