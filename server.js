const express = require('express');
const axios = require('axios');
const https = require('https');
const app = express();

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const BASE_URL = "https://formularioinscripcion.exteriores.gob.es";
const PORT = process.env.PORT || 3000;

const agent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true
});

app.use(express.json());

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

const axiosInstance = axios.create({
    httpsAgent: agent,
    httpAgent: new (require('http')).Agent({ keepAlive: true })
});

// ENDPOINT DEBUG - Para ver qué devuelve el servidor
app.post('/debug', async (req, res) => {
    const { identificador, consulado = '1' } = req.body;

    if (!identificador) {
        return res.json({ error: 'Identificador requerido' });
    }

    try {
        console.log(`[DEBUG] Validando: ${identificador}`);

        const formData = new URLSearchParams();
        formData.append('identificador', identificador.toUpperCase());
        formData.append('consulado', consulado);

        const validacionResponse = await axiosInstance.post(
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

        console.log(`[DEBUG] Status: ${validacionResponse.status}`);
        console.log(`[DEBUG] Datos completos:`, JSON.stringify(validacionResponse.data, null, 2));

        return res.json({
            status: validacionResponse.status,
            datos_completos: validacionResponse.data,
            claves: Object.keys(validacionResponse.data),
            valores_todos: validacionResponse.data
        });

    } catch (error) {
        console.error('[DEBUG ERROR]', error.message);
        return res.json({
            error: error.message,
            stack: error.stack
        });
    }
});

// ENDPOINT PRINCIPAL - Búsqueda
app.post('/buscar', async (req, res) => {
    const { identificador, consulado = '1' } = req.body;

    if (!identificador) {
        return res.json({ exito: false, error: 'Identificador requerido' });
    }

    try {
        console.log(`[BUSCAR] Iniciando búsqueda: ${identificador}`);

        const formData = new URLSearchParams();
        formData.append('identificador', identificador.toUpperCase());
        formData.append('consulado', consulado);

        console.log(`[BUSCAR] Validando...`);
        const validacionResponse = await axiosInstance.post(
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
        console.log(`[BUSCAR] Respuesta:`, JSON.stringify(validacionResponse.data, null, 2));

        if (!validacionResponse.data || !validacionResponse.data.existeIdentificador) {
            console.log(`[BUSCAR] ID no encontrado`);
            return res.json({
                exito: false,
                error: 'Identificador no encontrado en el sistema'
            });
        }

        // INTENTA ENCONTRAR EL EXPEDIENTE EN DIFERENTES NOMBRES DE CAMPO
        let expediente = null;
        const posiblesNombres = [
            'expediente',
            'numExpediente', 
            'numeroExpediente',
            'num_expediente',
            'numero_expediente',
            'resguardoNumero',
            'resguardo_numero',
            'idExpediente',
            'id_expediente',
            'trámite',
            'tramite',
            'ref',
            'referencia',
            'id'
        ];

        for (const nombre of posiblesNombres) {
            if (validacionResponse.data[nombre]) {
                expediente = validacionResponse.data[nombre];
                console.log(`[BUSCAR] Expediente encontrado en campo "${nombre}": ${expediente}`);
                break;
            }
        }

        if (!expediente) {
            console.log(`[BUSCAR] ❌ No se encontró expediente`);
            console.log(`[BUSCAR] Campos disponibles: ${Object.keys(validacionResponse.data).join(', ')}`);
            
            // Devolver la respuesta completa para que el usuario vea qué hay
            return res.json({
                exito: false,
                error: 'No se encontró número de expediente',
                debug: {
                    identificador: identificador,
                    status: validacionResponse.status,
                    respuesta_completa: validacionResponse.data,
                    campos_disponibles: Object.keys(validacionResponse.data),
                    sugerencia: 'Revisa los campos disponibles en "respuesta_completa"'
                }
            });
        }

        console.log(`[BUSCAR] Descargando PDF con expediente: ${expediente}...`);

        // Intentar descargar el PDF
        const urlPDF = `${BASE_URL}/citaprevia/documento/obtenerResguardo/${expediente}`;
        console.log(`[BUSCAR] URL del PDF: ${urlPDF}`);

        const resguardoResponse = await axiosInstance.get(urlPDF, {
            headers: getHeaders(),
            timeout: 15000,
            responseType: 'arraybuffer',
            validateStatus: () => true,
            maxRedirects: 10
        });

        console.log(`[BUSCAR] PDF status: ${resguardoResponse.status}`);
        console.log(`[BUSCAR] PDF size: ${resguardoResponse.data ? resguardoResponse.data.length : 0} bytes`);

        if (resguardoResponse.data && resguardoResponse.data.length > 0) {
            const pdfBase64 = Buffer.from(resguardoResponse.data).toString('base64');
            console.log(`[BUSCAR] ✅ PDF obtenido exitosamente`);
            
            return res.json({
                exito: true,
                expediente: expediente,
                resguardo: {
                    tamaño: resguardoResponse.data.length,
                    pdf_base64: pdfBase64
                }
            });
        } else {
            console.log(`[BUSCAR] ❌ No se obtuvo PDF`);
            return res.json({
                exito: false,
                error: `Error al descargar documento (HTTP ${resguardoResponse.status})`
            });
        }

    } catch (error) {
        console.error('[ERROR]', error.message);
        
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
        <p>Debug: POST /debug</p>
    `);
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

const listener = app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║  ✅ Servidor iniciado en Render.com    ║
║  Puerto: ${PORT}                          ║
║  Endpoint: POST /buscar                ║
║  Debug: POST /debug                    ║
╚════════════════════════════════════════╝
    `);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Rechazo no manejado:', reason);
});