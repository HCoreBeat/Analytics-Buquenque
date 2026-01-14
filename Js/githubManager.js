/**
 * Módulo de gestión de GitHub
 * Maneja la integración con la API de GitHub para guardar y cargar datos
 */

// Constantes de configuración
const GITHUB_CONFIG = {
    REPO: 'HCoreBeat/Analytics-Buquenque',
    FILE_PATH: 'Json/my_data.json',
    BRANCH: 'main'
};

export class GitHubManager {
    constructor() {
        this.token = localStorage.getItem('github_token') || null;
        this.apiBase = 'https://api.github.com';
    }

    /**
     * Valida que la configuración necesaria esté presente
     */
    isConfigured() {
        return this.token !== null && this.token !== '';
    }

    /**
     * Obtiene la configuración actual
     */
    getConfig() {
        return {
            token: this.token ? '***' : null,
            repo: GITHUB_CONFIG.REPO,
            filePath: GITHUB_CONFIG.FILE_PATH
        };
    }

    /**
     * Guarda el token de GitHub
     */
    saveToken(token) {
        this.token = token;
        localStorage.setItem('github_token', token);
        return true;
    }

    /**
     * Limpia el token de GitHub
     */
    clearToken() {
        this.token = null;
        localStorage.removeItem('github_token');
    }

    /**
     * Prueba la conexión con GitHub
     */
    async testConnection() {
        if (!this.isConfigured()) {
            throw new Error('Configuración incompleta. Por favor, configura tu token de GitHub.');
        }

        try {
            const response = await fetch(`${this.apiBase}/repos/${GITHUB_CONFIG.REPO}`, {
                headers: {
                    'Authorization': `token ${this.token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error('Repositorio no encontrado. Verifica el nombre.');
                } else if (response.status === 401) {
                    throw new Error('Token de GitHub inválido o expirado.');
                }
                throw new Error(`Error ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            return {
                success: true,
                repoName: data.name,
                repoUrl: data.html_url,
                isPrivate: data.private
            };
        } catch (error) {
            throw new Error(`Error de conexión: ${error.message}`);
        }
    }

    /**
     * Obtiene el contenido actual del archivo desde GitHub
     */
    async getFileContent() {
        if (!this.isConfigured()) {
            throw new Error('Configuración incompleta.');
        }

        try {
            const response = await fetch(
                `${this.apiBase}/repos/${GITHUB_CONFIG.REPO}/contents/${GITHUB_CONFIG.FILE_PATH}`,
                {
                    headers: {
                        'Authorization': `token ${this.token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                }
            );

            if (!response.ok) {
                if (response.status === 404) {
                    return null; // Archivo no existe
                }
                throw new Error(`Error ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            const content = atob(data.content); // Decodificar base64
            
            return {
                content: JSON.parse(content),
                sha: data.sha
            };
        } catch (error) {
            throw new Error(`Error al obtener archivo: ${error.message}`);
        }
    }

    /**
     * Guarda los pedidos en GitHub
     * @param {Array} pedidos - Array de pedidos a guardar
     * @param {String} commitMessage - Mensaje del commit
     */
    async savePedidos(pedidos, commitMessage = 'Actualizar pedidos - Analytics Dashboard') {
        if (!this.isConfigured()) {
            throw new Error('Configuración incompleta. Por favor, configura tu token de GitHub.');
        }

        try {
            // Intentar obtener el contenido actual para obtener el SHA
            let sha = null;
            try {
                const existing = await this.getFileContent();
                if (existing) {
                    sha = existing.sha;
                }
            } catch (error) {
                console.log('Archivo no existe, se creará uno nuevo');
            }

            // Preparar el contenido
            const fileContent = JSON.stringify(pedidos, null, 2);
            const encodedContent = btoa(unescape(encodeURIComponent(fileContent))); // Codificar a base64

            // Preparar el body de la solicitud
            const body = {
                message: commitMessage,
                content: encodedContent,
                branch: GITHUB_CONFIG.BRANCH
            };

            if (sha) {
                body.sha = sha; // Necesario para actualizar archivo existente
            }

            // Hacer la solicitud PUT a GitHub
            const response = await fetch(
                `${this.apiBase}/repos/${GITHUB_CONFIG.REPO}/contents/${GITHUB_CONFIG.FILE_PATH}`,
                {
                    method: 'PUT',
                    headers: {
                        'Authorization': `token ${this.token}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(body)
                }
            );

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Error ${response.status}: ${errorData.message || response.statusText}`);
            }

            const result = await response.json();
            return {
                success: true,
                message: 'Pedidos guardados exitosamente en GitHub',
                commit: result.commit.html_url,
                sha: result.content.sha
            };
        } catch (error) {
            throw new Error(`Error al guardar pedidos: ${error.message}`);
        }
    }

    /**
     * Carga los pedidos desde GitHub
     */
    async loadPedidos() {
        if (!this.isConfigured()) {
            throw new Error('Configuración incompleta.');
        }

        try {
            const result = await this.getFileContent();
            if (!result) {
                return [];
            }
            return result.content;
        } catch (error) {
            throw new Error(`Error al cargar pedidos: ${error.message}`);
        }
    }

    /**
     * Obtiene el historial de commits del archivo
     */
    async getCommitHistory(limit = 10) {
        if (!this.isConfigured()) {
            throw new Error('Configuración incompleta.');
        }

        try {
            const response = await fetch(
                `${this.apiBase}/repos/${GITHUB_CONFIG.REPO}/commits?path=${GITHUB_CONFIG.FILE_PATH}&per_page=${limit}`,
                {
                    headers: {
                        'Authorization': `token ${this.token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                }
            );

            if (!response.ok) {
                throw new Error(`Error ${response.status}: ${response.statusText}`);
            }

            const commits = await response.json();
            return commits.map(commit => ({
                sha: commit.sha.substring(0, 7),
                message: commit.commit.message,
                author: commit.commit.author.name,
                date: new Date(commit.commit.author.date),
                url: commit.html_url
            }));
        } catch (error) {
            throw new Error(`Error al obtener historial: ${error.message}`);
        }
    }

    /**
     * Sube un archivo a GitHub usando la API (para repositorio Buquenque)
     * @param {string} filePath - Ruta del archivo en el repositorio
     * @param {string} base64Content - Contenido en Base64
     * @param {string} message - Mensaje del commit
     */
    async uploadFile(filePath, base64Content, message = 'Actualizar archivo') {
        if (!this.isConfigured()) {
            throw new Error('Token de GitHub no configurado');
        }

        try {
            // Obtener SHA del archivo si existe (para actualización)
            let sha = null;
            try {
                const response = await fetch(
                    `${this.apiBase}/repos/HCoreBeat/Buquenque/contents/${filePath}`,
                    {
                        headers: {
                            'Authorization': `token ${this.token}`,
                            'Accept': 'application/vnd.github.v3+json'
                        }
                    }
                );

                if (response.ok) {
                    const data = await response.json();
                    sha = data.sha;
                }
            } catch (error) {
                console.log(`Archivo no existe o error al obtener SHA: ${filePath}`);
            }

            // Preparar el body
            const body = {
                message: message,
                content: base64Content,
                branch: 'main'
            };

            if (sha) {
                body.sha = sha;
            }

            // Hacer PUT a GitHub
            const response = await fetch(
                `${this.apiBase}/repos/HCoreBeat/Buquenque/contents/${filePath}`,
                {
                    method: 'PUT',
                    headers: {
                        'Authorization': `token ${this.token}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(body)
                }
            );

            if (!response.ok) {
                const errorData = await response.json();
                if (response.status === 409) {
                    throw new Error(`Conflicto al actualizar ${filePath}. Intenta de nuevo.`);
                } else if (response.status === 401) {
                    throw new Error('Token de GitHub inválido o expirado');
                }
                throw new Error(`Error ${response.status}: ${errorData.message || response.statusText}`);
            }

            const result = await response.json();
            return {
                success: true,
                message: `Archivo subido: ${filePath}`,
                commit: result.commit,
                sha: result.content.sha
            };
        } catch (error) {
            console.error('Error en uploadFile:', error);
            throw error;
        }
    }
}
