const express = require('express');
const axios = require('axios');
const app = express();

const BASE_URL = "https://formularioinscripcion.exteriores.gob.es";
const PORT = process.env.PORT || 3000;

app.use(express.json());

// CORS - Permitir todas las solicitudes
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Max-Age', '86400');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

const getHeaders = () => ({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'es-ES,es;q=0.9',
    'Referer': 'https://formularioinscripcion.exteriores.gob.es/',
    'Cache-Control': 'no-cache',
});

app.post('/buscar', async (req, res) => {
    const { identificador, consulado = '1' } = req.body;

    if (!identificador) {
        return res.json({ exito: false, error: 'Identificador requerido' });
    }

    try {
        console.log(`[BUSCAR] Iniciando búsqueda: ${identificador}`);

        // Paso 1: Validar
        const formData = new URLSearchParams();
        formData.append('identificador', identificador.toUpperCase());
        formData.append('consulado', consulado);

        console.log(`[BUSCAR] Validando...`);
        const validacionResponse = await axios.post(
            `${BASE_URL}/citaprevia/validaciones/validarIdentificador`,
            formData,
            {
                headers: { 
                    ...getHeaders(), 
                    'Content-Type': 'application/x-www-form-urlencoded' 
                },
                timeout: 15000,
                validateStatus: () => true,
                maxRedirects: 10
            }
        );

        console.log(`[BUSCAR] Validación status: ${validacionResponse.status}`);
        console.log(`[BUSCAR] Respuesta: ${JSON.stringify(validacionResponse.data)}`);

        if (!validacionResponse.data || !validacionResponse.data.existeIdentificador) {
            console.log(`[BUSCAR] ID no encontrado`);
            return res.json({
                exito: false,
                error: 'Identificador no encontrado en el sistema'
            });
        }

        console.log(`[BUSCAR] ID válido, obteniendo PDF...`);

        // Paso 2: Obtener resguardo
        const resguardoResponse = await axios.get(
            `${BASE_URL}/citaprevia/documentos/descargarDocumento`,
            {
                params: {
                    identificador: identificador.toUpperCase(),
                    consulado,
                    tipo: 'resguardo'
                },
                headers: getHeaders(),
                timeout: 15000,
                responseType: 'arraybuffer',
                validateStatus: () => true,
                maxRedirects: 10
            }
        );

        console.log(`[BUSCAR] PDF status: ${resguardoResponse.status}`);
        console.log(`[BUSCAR] PDF size: ${resguardoResponse.data ? resguardoResponse.data.length : 0} bytes`);

        if (resguardoResponse.data && resguardoResponse.data.length > 0) {
            const pdfBase64 = Buffer.from(resguardoResponse.data).toString('base64');
            console.log(`[BUSCAR] ✅ PDF obtenido exitosamente`);
            
            return res.json({
                exito: true,
                resguardo: {
                    tamaño: resguardoResponse.data.length,
                    pdf_base64: pdfBase64
                }
            });
        } else {
            console.log(`[BUSCAR] ❌ No se obtuvo PDF`);
            return res.json({
                exito: false,
                error: 'Error al descargar documento'
            });
        }

    } catch (error) {
        console.error('[ERROR]', error.message);
        console.error('[ERROR] Stack:', error.stack);
        
        return res.json({
            exito: false,
            error: `Error: ${error.message}`
        });
    }
});

app.get('/', (req, res) => {
    res.send(`
        <h1>✅ Servidor Buscador de Resguardos</h1>
        <p>Consulado de España en La Habana</p>
        <p>Endpoint: POST /buscar</p>
    `);
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const listener = app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║  ✅ Servidor iniciado en Render.com    ║
║  Puerto: ${PORT}                          ║
║  Endpoint: POST /buscar                ║
╚════════════════════════════════════════╝
    `);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Rechazo no manejado:', reason);
});
