const fs = require('fs');
const path = require('path');

function resolveChromeExecutablePath() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    const isWindows = process.platform === 'win32';
    if (!isWindows) {
        const linuxPaths = [
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable'
        ];
        return linuxPaths.find((exePath) => fs.existsSync(exePath));
    }

    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const programFilesX86 =
        process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';

    const possiblePaths = [
        path.join(
            localAppData,
            'Google',
            'Chrome',
            'Application',
            'chrome.exe'
        ),
        path.join(
            programFiles,
            'Google',
            'Chrome',
            'Application',
            'chrome.exe'
        ),
        path.join(
            programFilesX86,
            'Google',
            'Chrome',
            'Application',
            'chrome.exe'
        )
    ];

    return possiblePaths.find((exePath) => fs.existsSync(exePath));
}

const executablePath = resolveChromeExecutablePath();
const isWindows = process.platform === 'win32';
const defaultHeadless = isWindows ? 'false' : 'true';
const headless = (process.env.BOT_HEADLESS || defaultHeadless).toLowerCase() === 'true';
const protocolTimeout = Number(process.env.PUPPETEER_PROTOCOL_TIMEOUT_MS || 180000);

if (executablePath) {
    console.log(`Usando navegador local para Puppeteer: ${executablePath}`);
} else {
    console.log(
        'No se detecto Chrome local. Se intentara usar el navegador administrado por Puppeteer.'
    );
}

console.log(`Puppeteer headless=${headless}`);
console.log(`Puppeteer protocolTimeout=${protocolTimeout}ms`);

module.exports = {
    headless,
    executablePath,
    protocolTimeout,
    args: [
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
    ].concat(isWindows ? [] : ['--no-sandbox', '--disable-setuid-sandbox']),
    defaultViewport: null
};