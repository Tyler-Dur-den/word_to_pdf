import { useState, useRef, useCallback } from 'react';
import mammoth from 'mammoth';
import html2pdf from 'html2pdf.js';
import { marked } from 'marked';
import { jsPDF } from 'jspdf';

type ConversionStatus = 'idle' | 'converting' | 'ready' | 'error';

interface FileType {
  extension: string;
  label: string;
  category: 'document' | 'image' | 'text';
}



const FILE_TYPES: Record<string, FileType> = {
  docx: { extension: 'docx', label: 'Word Document', category: 'document' },
  doc: { extension: 'doc', label: 'Word Document', category: 'document' },
  pdf: { extension: 'pdf', label: 'PDF', category: 'document' },
  html: { extension: 'html', label: 'HTML', category: 'text' },
  md: { extension: 'md', label: 'Markdown', category: 'text' },
  txt: { extension: 'txt', label: 'Plain Text', category: 'text' },
  png: { extension: 'png', label: 'PNG Image', category: 'image' },
  jpg: { extension: 'jpg', label: 'JPG Image', category: 'image' },
  jpeg: { extension: 'jpeg', label: 'JPEG Image', category: 'image' },
  webp: { extension: 'webp', label: 'WebP Image', category: 'image' },
};

const CONVERSION_MAP: Record<string, string[]> = {
  docx: ['pdf', 'html', 'txt'],
  doc: ['pdf', 'html', 'txt'],
  md: ['pdf', 'html'],
  txt: ['pdf'],
  html: ['pdf'],
  png: ['pdf', 'jpg', 'webp'],
  jpg: ['pdf', 'png', 'webp'],
  jpeg: ['pdf', 'png', 'webp'],
  webp: ['pdf', 'png', 'jpg'],
};

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<ConversionStatus>('idle');
  const [outputFormat, setOutputFormat] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [previewType, setPreviewType] = useState<'html' | 'image' | 'text'>('html');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const getFileExtension = (filename: string): string => {
    return filename.split('.').pop()?.toLowerCase() || '';
  };

  const getAvailableOutputFormats = (ext: string): string[] => {
    return CONVERSION_MAP[ext] || [];
  };

  const handleFileSelect = useCallback(async (selectedFile: File) => {
    const ext = getFileExtension(selectedFile.name);
    
    if (!CONVERSION_MAP[ext]) {
      setErrorMessage(`Unsupported file type: .${ext}`);
      setStatus('error');
      return;
    }

    setFile(selectedFile);
    setStatus('idle');
    setErrorMessage('');
    setOutputFormat('');
    setPreviewContent('');

    // Generate preview based on file type
    const fileType = FILE_TYPES[ext];
    
    try {
      if (fileType?.category === 'image') {
        const url = URL.createObjectURL(selectedFile);
        setPreviewContent(url);
        setPreviewType('image');
      } else if (ext === 'docx' || ext === 'doc') {
        const arrayBuffer = await selectedFile.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        setPreviewContent(result.value);
        setPreviewType('html');
      } else if (ext === 'md') {
        const text = await selectedFile.text();
        const html = await marked(text);
        setPreviewContent(html);
        setPreviewType('html');
      } else if (ext === 'html') {
        const text = await selectedFile.text();
        setPreviewContent(text);
        setPreviewType('html');
      } else if (ext === 'txt') {
        const text = await selectedFile.text();
        setPreviewContent(text);
        setPreviewType('text');
      }
    } catch (error) {
      console.error('Preview error:', error);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelect(selectedFile);
    }
  };

  const convertImageFormat = async (
    file: File,
    targetFormat: 'png' | 'jpg' | 'webp'
  ): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        // Fill white background for JPG (no transparency)
        if (targetFormat === 'jpg') {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        
        ctx.drawImage(img, 0, 0);
        
        const mimeType = targetFormat === 'jpg' ? 'image/jpeg' : `image/${targetFormat}`;
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url);
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to convert image'));
            }
          },
          mimeType,
          0.92
        );
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };
      
      img.src = url;
    });
  };

  const convertImageToPdf = async (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      
      img.onload = () => {
        const pdf = new jsPDF({
          orientation: img.width > img.height ? 'landscape' : 'portrait',
          unit: 'px',
        });
        
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        
        // Scale image to fit page
        const scale = Math.min(pageWidth / img.width, pageHeight / img.height) * 0.9;
        const scaledWidth = img.width * scale;
        const scaledHeight = img.height * scale;
        
        const x = (pageWidth - scaledWidth) / 2;
        const y = (pageHeight - scaledHeight) / 2;
        
        // Create canvas to get image data
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0);
        
        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        pdf.addImage(imgData, 'JPEG', x, y, scaledWidth, scaledHeight);
        
        URL.revokeObjectURL(url);
        resolve(pdf.output('blob'));
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };
      
      img.src = url;
    });
  };

  const downloadFile = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const convertFile = async () => {
    if (!file || !outputFormat) return;

    setStatus('converting');
    const ext = getFileExtension(file.name);
    const baseFilename = file.name.replace(/\.[^/.]+$/, '');

    try {
      // Document to PDF
      if (outputFormat === 'pdf' && ['docx', 'doc', 'md', 'html', 'txt'].includes(ext)) {
        let htmlContent = '';

        if (ext === 'docx' || ext === 'doc') {
          const arrayBuffer = await file.arrayBuffer();
          const result = await mammoth.convertToHtml({ arrayBuffer });
          htmlContent = result.value;
        } else if (ext === 'md') {
          const text = await file.text();
          htmlContent = await marked(text);
        } else if (ext === 'html') {
          htmlContent = await file.text();
        } else if (ext === 'txt') {
          const text = await file.text();
          htmlContent = `<pre style="white-space: pre-wrap; font-family: monospace;">${text}</pre>`;
        }

        const container = document.createElement('div');
        container.innerHTML = htmlContent;
        container.style.padding = '20px';
        container.style.fontFamily = 'Arial, sans-serif';
        container.style.lineHeight = '1.6';
        document.body.appendChild(container);

        const opt = {
          margin: [10, 10, 10, 10] as [number, number, number, number],
          filename: `${baseFilename}.pdf`,
          image: { type: 'jpeg' as const, quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'mm' as const, format: 'a4', orientation: 'portrait' as const }
        };

        await html2pdf().set(opt).from(container).save();
        document.body.removeChild(container);
      }
      
      // Document to HTML
      else if (outputFormat === 'html' && ['docx', 'doc', 'md'].includes(ext)) {
        let htmlContent = '';

        if (ext === 'docx' || ext === 'doc') {
          const arrayBuffer = await file.arrayBuffer();
          const result = await mammoth.convertToHtml({ arrayBuffer });
          htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${baseFilename}</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; }
  </style>
</head>
<body>
${result.value}
</body>
</html>`;
        } else if (ext === 'md') {
          const text = await file.text();
          const body = await marked(text);
          htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${baseFilename}</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; }
    pre { background: #f4f4f4; padding: 10px; border-radius: 5px; overflow-x: auto; }
    code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
        }

        const blob = new Blob([htmlContent], { type: 'text/html' });
        downloadFile(blob, `${baseFilename}.html`);
      }
      
      // Document to Text
      else if (outputFormat === 'txt' && ['docx', 'doc'].includes(ext)) {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        const blob = new Blob([result.value], { type: 'text/plain' });
        downloadFile(blob, `${baseFilename}.txt`);
      }
      
      // Image to PDF
      else if (outputFormat === 'pdf' && ['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
        const blob = await convertImageToPdf(file);
        downloadFile(blob, `${baseFilename}.pdf`);
      }
      
      // Image format conversion
      else if (['png', 'jpg', 'webp'].includes(outputFormat) && ['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
        const targetFormat = outputFormat as 'png' | 'jpg' | 'webp';
        const blob = await convertImageFormat(file, targetFormat);
        downloadFile(blob, `${baseFilename}.${targetFormat}`);
      }

      setStatus('ready');
    } catch (error) {
      console.error('Conversion error:', error);
      setErrorMessage('Failed to convert the file. Please try again.');
      setStatus('error');
    }
  };

  const resetConverter = () => {
    setFile(null);
    setStatus('idle');
    setOutputFormat('');
    setPreviewContent('');
    setErrorMessage('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const supportedExtensions = Object.keys(CONVERSION_MAP).map(ext => `.${ext}`).join(',');

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-blue-50 to-cyan-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
              <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </div>
            <div>
              <div style={{
                position: "absolute",
                top: "20px",
                right: "30px",
                fontWeight: "bold",
                fontSize: "18px"
              }}>
                Vine Production
              </div>
              <h1 className="text-2xl font-bold text-gray-800">Universal File Converter</h1>
              <p className="text-sm text-gray-500">Convert documents and images between formats</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-12">
        {!file ? (
          <div className="flex flex-col items-center">
            {/* Upload Area */}
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`w-full max-w-2xl p-12 border-2 border-dashed rounded-2xl transition-all duration-300 cursor-pointer ${
                isDragging
                  ? 'border-violet-500 bg-violet-50 scale-[1.02]'
                  : 'border-gray-300 bg-white hover:border-violet-400 hover:bg-violet-50/50'
              }`}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={supportedExtensions}
                onChange={handleInputChange}
                className="hidden"
              />
              
              <div className="flex flex-col items-center text-center">
                <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-6 transition-all ${
                  isDragging ? 'bg-violet-100' : 'bg-gray-100'
                }`}>
                  <svg className={`w-10 h-10 ${isDragging ? 'text-violet-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                
                <h3 className="text-xl font-semibold text-gray-700 mb-2">
                  {isDragging ? 'Drop your file here' : 'Drag & drop your file'}
                </h3>
                <p className="text-gray-500 mb-4">or click to browse</p>
                <span className="inline-flex items-center px-4 py-2 bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-700 transition-colors">
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Select File
                </span>
              </div>
            </div>

            {/* Error Message */}
            {status === 'error' && (
              <div className="mt-6 w-full max-w-2xl p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3">
                <svg className="w-6 h-6 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-red-700">{errorMessage}</p>
              </div>
            )}

            {/* Supported Formats */}
            <div className="mt-12 w-full max-w-4xl">
              <h3 className="text-lg font-semibold text-gray-700 text-center mb-6">Supported Conversions</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  { from: 'Word (.docx)', to: 'PDF, HTML, Text', icon: '📄', color: 'blue' },
                  { from: 'Markdown (.md)', to: 'PDF, HTML', icon: '📝', color: 'purple' },
                  { from: 'Text (.txt)', to: 'PDF', icon: '📃', color: 'gray' },
                  { from: 'HTML (.html)', to: 'PDF', icon: '🌐', color: 'orange' },
                  { from: 'PNG Image', to: 'PDF, JPG, WebP', icon: '🖼️', color: 'green' },
                  { from: 'JPG Image', to: 'PDF, PNG, WebP', icon: '📷', color: 'pink' },
                ].map((item, i) => (
                  <div key={i} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-start gap-3">
                    <span className="text-2xl">{item.icon}</span>
                    <div>
                      <p className="font-medium text-gray-800">{item.from}</p>
                      <p className="text-sm text-gray-500">→ {item.to}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Features */}
            <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-4xl">
              {[
                { icon: '⚡', title: 'Fast Conversion', desc: 'Convert your files in seconds' },
                { icon: '🔒', title: 'Secure & Private', desc: 'Files are processed locally in your browser' },
                { icon: '💯', title: 'Free & Unlimited', desc: 'No file size limits, no watermarks' }
              ].map((feature, i) => (
                <div key={i} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 text-center">
                  <span className="text-4xl mb-4 block">{feature.icon}</span>
                  <h4 className="font-semibold text-gray-800 mb-2">{feature.title}</h4>
                  <p className="text-sm text-gray-500">{feature.desc}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            {/* File Info & Conversion Options */}
            <div className="w-full max-w-4xl bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
              {/* Header */}
              <div className="p-6 bg-gradient-to-r from-violet-500 to-blue-600 text-white">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-white/20 backdrop-blur rounded-xl flex items-center justify-center">
                      {FILE_TYPES[getFileExtension(file.name)]?.category === 'image' ? (
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      ) : (
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      )}
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg truncate max-w-md">{file.name}</h3>
                      <p className="text-blue-100 text-sm">
                        {(file.size / 1024).toFixed(1)} KB • {FILE_TYPES[getFileExtension(file.name)]?.label || 'Unknown'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={resetConverter}
                    className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Cancel
                  </button>
                </div>
              </div>

              {/* Conversion Options */}
              <div className="p-6 border-b border-gray-100">
                <h4 className="font-medium text-gray-700 mb-4">Convert to:</h4>
                <div className="flex flex-wrap gap-3">
                  {getAvailableOutputFormats(getFileExtension(file.name)).map((format) => (
                    <button
                      key={format}
                      onClick={() => setOutputFormat(format)}
                      className={`px-6 py-3 rounded-xl font-medium transition-all ${
                        outputFormat === format
                          ? 'bg-violet-600 text-white shadow-lg'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {format.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Status & Actions */}
              {status === 'converting' && (
                <div className="p-8 flex flex-col items-center">
                  <div className="w-16 h-16 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin mb-4"></div>
                  <p className="text-gray-600 font-medium">Converting your file...</p>
                </div>
              )}

              {status === 'error' && (
                <div className="p-6">
                  <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3">
                    <svg className="w-6 h-6 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-red-700">{errorMessage}</p>
                  </div>
                </div>
              )}

              {status === 'ready' && (
                <div className="p-6 bg-green-50 flex items-center justify-center gap-3">
                  <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <p className="text-green-700 font-medium">Conversion complete! Your file has been downloaded.</p>
                </div>
              )}

              {/* Preview */}
              {previewContent && status !== 'converting' && (
                <div className="p-6 bg-gray-50">
                  <h4 className="font-medium text-gray-700 mb-4">Preview</h4>
                  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden max-h-[400px] overflow-y-auto">
                    {previewType === 'image' ? (
                      <img src={previewContent} alt="Preview" className="max-w-full h-auto mx-auto" />
                    ) : previewType === 'text' ? (
                      <pre className="p-4 text-sm text-gray-700 whitespace-pre-wrap font-mono">{previewContent}</pre>
                    ) : (
                      <div
                        ref={contentRef}
                        className="p-6 prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{ __html: previewContent }}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Convert Button */}
              {outputFormat && status !== 'converting' && (
                <div className="p-6 border-t border-gray-100 flex justify-center">
                  <button
                    onClick={convertFile}
                    className="px-8 py-4 bg-gradient-to-r from-violet-500 to-blue-600 text-white rounded-xl font-semibold hover:from-violet-600 hover:to-blue-700 transition-all shadow-lg hover:shadow-xl flex items-center gap-3"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Convert to {outputFormat.toUpperCase()} & Download
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="py-8 text-center text-gray-400 text-sm">
        <p>Universal File Converter • Your files never leave your browser</p>
      </footer>
    </div>
  );
}

export default App;
