/**
 * Cerimonial BAGL - Utilitários de Processamento, Redimensionamento e Compressão de Fotografias
 * Garante qualidade nítida no carômetro com tamanho compacto em Base64 para o IndexedDB.
 */
window.CerimonialPhotoUtils = (function () {
  const MAX_WIDTH = 320;
  const MAX_HEIGHT = 400;
  const JPEG_QUALITY = 0.82;

  /**
   * Lê um arquivo de imagem (File/Blob), redimensiona proporcionalmente se necessário
   * e comprime para Data URL JPEG (Base64).
   * Possui fallback direto para o Data URL original em ambientes sem Canvas (ex: testes Node).
   */
  function processImageFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('Nenhum arquivo de imagem fornecido.'));
        return;
      }

      if (file.type && !file.type.startsWith('image/')) {
        reject(new Error('O arquivo selecionado não é uma imagem válida.'));
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const rawDataUrl = e.target.result;
        if (!rawDataUrl || typeof rawDataUrl !== 'string') {
          reject(new Error('Falha ao ler os dados da imagem.'));
          return;
        }

        // Em ambiente de navegador real com Image e Canvas disponíveis, redimensionar e comprimir
        if (typeof window.Image === 'function' && typeof document.createElement === 'function') {
          try {
            const img = new window.Image();
            img.onload = () => {
              try {
                let width = img.width || MAX_WIDTH;
                let height = img.height || MAX_HEIGHT;

                if (width > MAX_WIDTH || height > MAX_HEIGHT) {
                  const ratio = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
                  width = Math.round(width * ratio);
                  height = Math.round(height * ratio);
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext && canvas.getContext('2d');
                if (ctx && typeof canvas.toDataURL === 'function') {
                  ctx.fillStyle = '#ffffff';
                  ctx.fillRect(0, 0, width, height);
                  ctx.drawImage(img, 0, 0, width, height);
                  const compressed = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
                  resolve(compressed);
                } else {
                  resolve(rawDataUrl);
                }
              } catch (canvasErr) {
                resolve(rawDataUrl);
              }
            };
            img.onerror = () => {
              // Se não conseguiu decodificar via Image mock, mas é Data URL de imagem, retorna rawDataUrl
              if (rawDataUrl.startsWith('data:image/')) {
                resolve(rawDataUrl);
              } else {
                reject(new Error('Não foi possível processar a imagem selecionada.'));
              }
            };
            img.src = rawDataUrl;
          } catch (err) {
            resolve(rawDataUrl);
          }
        } else {
          resolve(rawDataUrl);
        }
      };

      reader.onerror = () => reject(new Error('Erro ao ler o arquivo de imagem no dispositivo.'));
      reader.readAsDataURL(file);
    });
  }

  return {
    processImageFile
  };
})();
