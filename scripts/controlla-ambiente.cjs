// Controlla i prerequisiti per compilare Wrambi su Windows.
// Eseguito da scripts\ambiente.cmd; volutamente semplice e senza dipendenze.
'use strict';
var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

// Segnale per lo script batch: "mancano solo gli strumenti C++" (propone di installarli).
var MARKER = path.join(os.tmpdir(), 'wrambi-mancano-cpp.txt');
try {
  fs.unlinkSync(MARKER);
} catch (e) {
  /* non c'era */
}

var RUST_MIN = [1, 92];
var problems = 0;
var missingCpp = false;

function ok(msg) { console.log('  ok  ' + msg); }
function warn(msg) { console.log('\n  ATTENZIONE: ' + msg + '\n'); }
function fail(msg) { console.log('\n  ERRORE: ' + msg); problems++; }

function run(cmd, args) {
  try {
    return cp.execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    return null;
  }
}

// Node.js
var nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
if (nodeMajor < 20) fail('serve Node.js 20 o successivo (trovato ' + process.versions.node + '). Aggiornalo da https://nodejs.org');
else ok('Node.js ' + process.versions.node);

// Rust
var rustc = run('rustc', ['--version']);
if (!rustc) {
  fail('manca Rust. Installalo da https://rustup.rs con le impostazioni predefinite, poi riapri lo script.');
} else {
  var m = /rustc (\d+)\.(\d+)/.exec(rustc);
  var tooOld = m && (parseInt(m[1], 10) < RUST_MIN[0] || (parseInt(m[1], 10) === RUST_MIN[0] && parseInt(m[2], 10) < RUST_MIN[1]));
  if (tooOld) {
    console.log('  Rust ' + m[1] + '.' + m[2] + ' e\' troppo vecchio per Wrambi: aggiorno con "rustup update stable"...');
    try {
      cp.execFileSync('rustup', ['update', 'stable'], { stdio: 'inherit' });
      rustc = run('rustc', ['--version']);
    } catch (e) {
      fail('non sono riuscito ad aggiornare Rust. Prova a mano: rustup update stable');
    }
  }
  var info = run('rustc', ['-vV']) || '';
  var host = (/^host:\s*(\S+)/m.exec(info) || [])[1] || '';
  if (process.platform === 'win32' && host.indexOf('msvc') < 0) {
    fail('Rust usa la toolchain "' + host + '". Serve quella MSVC: rustup default stable-x86_64-pc-windows-msvc');
  } else if (rustc) {
    ok(rustc.split(' (')[0] + (host ? ' (' + host + ')' : ''));
  }
}

// Strumenti C++ di Visual Studio e SDK di Windows: servono a Rust per creare l'eseguibile.
function onPath(exe) {
  return (process.env.PATH || '').split(';').some(function (d) {
    try {
      return d && fs.existsSync(path.join(d, exe));
    } catch (e) {
      return false;
    }
  });
}

function windowsSdkLib() {
  var pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  var lib = path.join(pf86, 'Windows Kits', '10', 'Lib');
  try {
    return fs.readdirSync(lib).some(function (v) {
      return fs.existsSync(path.join(lib, v, 'um', 'x64', 'kernel32.lib'));
    });
  } catch (e) {
    return false;
  }
}

if (process.platform === 'win32') {
  var vc = null;
  if (process.env.VCINSTALLDIR && onPath('link.exe')) {
    vc = process.env.VCINSTALLDIR;
  } else {
    var pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    var vswhere = path.join(pf86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    if (fs.existsSync(vswhere)) {
      vc =
        run(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath']) ||
        null;
    }
  }
  var sdk = windowsSdkLib();
  if (vc) ok('strumenti C++ di Visual Studio (' + vc + ')');
  if (sdk) ok('SDK di Windows');
  if (!vc || !sdk) {
    missingCpp = true;
    console.log('');
    console.log('  MANCANO: ' + [!vc ? 'gli strumenti C++ di Visual Studio (il linker link.exe)' : '', !sdk ? "l'SDK di Windows" : '']
      .filter(Boolean)
      .join(' e ') + '.');
    console.log('  Rust ne ha bisogno per creare l\'eseguibile. Si installano insieme, gratis, con');
    console.log('  "Strumenti di compilazione di Visual Studio 2022", carico di lavoro "Sviluppo di applicazioni desktop con C++".');
  }
}

if (problems) {
  console.log('\n  Risolvi quanto indicato e riavvia lo script.');
  process.exit(1);
}
if (missingCpp) {
  try {
    fs.writeFileSync(MARKER, '1');
  } catch (e) {
    /* senza segnale lo script mostra le istruzioni per l'installazione a mano */
  }
  process.exit(1);
}
