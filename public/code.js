/**
 * RF-SMART Code Studio - Client Engine
 * 
 * Features:
 * - Project Tree Navigation & Multi-Tab Editor
 * - Syntax Highlighting via Prism.js
 * - Command-Click / Ctrl-Click Go-to-Definition across files & symbols
 * - Relative import path resolution (e.g. '../services/auth.js', 'N/record')
 * - Back & Forward Navigation History Stack
 * - Live Middleware & RESTlet Test Console
 */

document.addEventListener('DOMContentLoaded', () => {
  let projectFiles = [];
  let symbolsIndex = [];
  let openTabs = [];
  let activeFilePath = null;
  let currentFileContent = '';

  // Navigation History Stack
  const navHistory = [];
  let navHistoryIndex = -1;
  let isNavigatingHistory = false;

  // Modifier Key State (⌘ Cmd / Ctrl)
  let isCmdDown = false;

  // DOM Elements
  const fileTreeContainer = document.getElementById('fileTreeContainer');
  const filesCountBadge = document.getElementById('filesCountBadge');
  const fileSearchInput = document.getElementById('fileSearchInput');
  const editorTabsBar = document.getElementById('editorTabsBar');
  const breadcrumbDisplay = document.getElementById('breadcrumbDisplay');
  const contextLayerBadge = document.getElementById('contextLayerBadge');
  const contextFileDesc = document.getElementById('contextFileDesc');
  const codeViewer = document.getElementById('codeViewer');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const copyCodeBtn = document.getElementById('copyCodeBtn');
  const editorViewport = document.querySelector('.editor-viewport');
  const defTooltip = document.getElementById('defTooltip');
  const tooltipTarget = document.getElementById('tooltipTarget');
  const btnNavBack = document.getElementById('btnNavBack');
  const btnNavForward = document.getElementById('btnNavForward');

  // Playground Elements
  const playgroundDrawer = document.getElementById('playgroundDrawer');
  const drawerBar = document.getElementById('drawerBar');
  const togglePlaygroundBtn = document.getElementById('togglePlaygroundBtn');
  const closeDrawerBtn = document.getElementById('closeDrawerBtn');
  const testBarcodeInput = document.getElementById('testBarcodeInput');
  const runLookupTestBtn = document.getElementById('runLookupTestBtn');
  const resStatusBadge = document.getElementById('resStatusBadge');
  const resLatencyDisplay = document.getElementById('resLatencyDisplay');
  const resTbaDisplay = document.getElementById('resTbaDisplay');
  const resBodyDisplay = document.getElementById('resBodyDisplay');

  // Initialize: Fetch project files and symbol table in parallel
  async function initProject() {
    try {
      const [filesRes, symbolsRes] = await Promise.all([
        fetch('/api/ide/files'),
        fetch('/api/ide/symbols')
      ]);

      const filesData = await filesRes.json();
      const symbolsData = await symbolsRes.json();

      if (filesData.success && filesData.files) {
        projectFiles = filesData.files;
        filesCountBadge.textContent = `${projectFiles.length} files`;
        renderFileTree(projectFiles);
      }

      if (symbolsData.success && symbolsData.symbols) {
        symbolsIndex = symbolsData.symbols;
      }

      // Default opening file: server/routes/scanner.js (central route hub)
      const defaultFile = projectFiles.find(f => f.path === 'server/routes/scanner.js') || projectFiles[0];
      if (defaultFile) {
        openFile(defaultFile.path, null, true);
      }
    } catch (err) {
      console.error('Failed to load project files or symbols:', err);
      breadcrumbDisplay.textContent = 'Error connecting to RF-SMART backend on port 7370';
    }
  }

  // Render Sidebar Tree
  function renderFileTree(files) {
    fileTreeContainer.innerHTML = '';

    const groups = {};
    for (const file of files) {
      if (!groups[file.category]) groups[file.category] = [];
      groups[file.category].push(file);
    }

    const groupIcons = {
      'Node.js Middleware': '⚡',
      'Mock NetSuite SuiteScript 2.1': '☁️',
      'Handheld Scanner (Knockout)': '📱',
      'Automated Tests': '🧪',
      'Documentation': '📄'
    };

    for (const [category, catFiles] of Object.entries(groups)) {
      const groupEl = document.createElement('div');
      groupEl.className = 'tree-group';

      const icon = groupIcons[category] || '📁';
      groupEl.innerHTML = `
        <div class="tree-group-header">
          <span>${icon}</span>
          <span>${category}</span>
        </div>
      `;

      for (const f of catFiles) {
        const itemEl = document.createElement('div');
        itemEl.className = `tree-item ${f.path === activeFilePath ? 'active' : ''}`;
        itemEl.dataset.path = f.path;

        const ext = f.name.split('.').pop();
        itemEl.innerHTML = `
          <div class="tree-item-name">
            <span class="ext-badge ${ext}">${ext.toUpperCase()}</span>
            <span>${f.name}</span>
          </div>
        `;

        itemEl.addEventListener('click', () => {
          navigateTo(f.path, 1);
        });
        groupEl.appendChild(itemEl);
      }

      fileTreeContainer.appendChild(groupEl);
    }
  }

  // Open file in Editor
  async function openFile(filePath, targetLine = null, recordHistory = true) {
    const fileMeta = projectFiles.find(f => f.path === filePath);
    if (!fileMeta) return;

    // Track Navigation History
    if (recordHistory && !isNavigatingHistory) {
      if (activeFilePath && activeFilePath !== filePath) {
        pushHistory(activeFilePath, 1);
      }
      pushHistory(filePath, targetLine || 1);
    }

    activeFilePath = filePath;

    // Add to open tabs if not present
    if (!openTabs.includes(filePath)) {
      openTabs.push(filePath);
    }

    renderTabs();
    updateSidebarActiveState();

    loadingOverlay.classList.add('visible');

    try {
      const response = await fetch(`/api/ide/file?path=${encodeURIComponent(filePath)}`);
      const data = await response.json();

      if (data.success && data.file) {
        const file = data.file;
        currentFileContent = file.content;

        // Update Breadcrumb & Context Header
        if (breadcrumbDisplay) breadcrumbDisplay.textContent = `RFSmart > ${file.path.replace(/\//g, ' > ')}`;
        if (contextLayerBadge) {
          contextLayerBadge.textContent = file.layer;
          contextLayerBadge.className = `info-layer badge-${file.layer.toLowerCase()}`;
        }
        if (contextFileDesc) contextFileDesc.textContent = file.description;

        // Set Code Content
        codeViewer.className = `language-${file.language}`;
        codeViewer.textContent = file.content;

        // Trigger Prism syntax highlighting
        if (window.Prism) {
          Prism.highlightElement(codeViewer);
        }

        // Annotate tokens for Command-Click navigation
        annotateNavigableTokens(filePath);

        // Scroll to requested line if provided
        if (targetLine) {
          setTimeout(() => scrollToLine(targetLine), 60);
        }
      } else {
        codeViewer.textContent = `Error loading file: ${data.error || 'Unknown error'}`;
      }
    } catch (err) {
      codeViewer.textContent = `Failed to connect to server: ${err.message}`;
    } finally {
      loadingOverlay.classList.remove('visible');
    }
  }

  // Resolves relative import path (e.g. '../services/auth.js') to an existing project file
  function resolveImportPath(currentFile, importString) {
    if (!importString) return null;
    const clean = importString.replace(/^['"`]|['"`]$/g, '').trim();

    // Virtual SuiteScript AMD module identifiers
    if (clean === 'N/record') return { file: 'server/netsuite-mock/nRecord.js', line: 1, name: 'N/record' };
    if (clean === 'N/search') return { file: 'server/netsuite-mock/nSearch.js', line: 1, name: 'N/search' };

    const dir = currentFile.includes('/') ? currentFile.substring(0, currentFile.lastIndexOf('/')) : '';
    const parts = dir ? dir.split('/') : [];
    const relParts = clean.split('/');

    for (const p of relParts) {
      if (p === '.' || p === '') continue;
      if (p === '..') {
        parts.pop();
      } else {
        parts.push(p);
      }
    }

    const resolved = parts.join('/');
    const match = projectFiles.find(f => f.path === resolved || f.path === `${resolved}.js` || f.name === clean);
    return match ? { file: match.path, line: 1, name: match.name } : null;
  }

  // Finds symbol definition in symbol table
  function resolveSymbol(word) {
    if (!word || word.length < 2) return null;

    // Direct match in symbols index
    const match = symbolsIndex.find(s => s.name === word);
    if (match) return match;

    // Check if word matches a file name directly (e.g. "auth.js" or "scanner")
    const fileMatch = projectFiles.find(f => f.name === word || f.name.replace(/\.[^.]+$/, '') === word);
    if (fileMatch) return { file: fileMatch.path, line: 1, name: fileMatch.name, kind: 'file' };

    return null;
  }

  // Annotates tokens in the rendered Prism DOM to make them Cmd-clickable
  function annotateNavigableTokens(currentFile) {
    const tokens = codeViewer.querySelectorAll('.token.string, .token.function, .token.class-name, .token.variable, .token.property');

    tokens.forEach(el => {
      const text = el.textContent.trim();

      // Case 1: String import path (e.g. '../services/auth.js' or 'N/record')
      if (el.classList.contains('string')) {
        const clean = text.replace(/^['"`]|['"`]$/g, '');
        const resolved = resolveImportPath(currentFile, clean);
        if (resolved) {
          el.classList.add('nav-clickable');
          el.dataset.targetFile = resolved.file;
          el.dataset.targetLine = resolved.line || 1;
          el.dataset.targetName = resolved.name || clean;
          return;
        }
      }

      // Case 2: Function, Class, or Variable Symbol
      const sym = resolveSymbol(text);
      if (sym) {
        el.classList.add('nav-clickable');
        el.dataset.targetFile = sym.file;
        el.dataset.targetLine = sym.line || 1;
        el.dataset.targetName = sym.name;
      }
    });
  }

  // Smoothly scrolls to target line and gives a brief highlight flash
  function scrollToLine(targetLine) {
    const pre = document.querySelector('.editor-viewport pre');
    if (!pre) return;

    const lineRows = pre.querySelector('.line-numbers-rows');
    if (!lineRows || !lineRows.children || lineRows.children.length === 0) return;

    const lineIdx = Math.max(0, Math.min(targetLine - 1, lineRows.children.length - 1));
    const targetRow = lineRows.children[lineIdx];

    if (targetRow) {
      targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetRow.classList.add('line-highlight-flash');
      setTimeout(() => {
        targetRow.classList.remove('line-highlight-flash');
      }, 1900);
    }
  }

  // Navigate to file and line
  function navigateTo(filePath, line = 1) {
    openFile(filePath, line, true);
  }

  // History Management
  function pushHistory(filePath, line = 1) {
    // Truncate forward history if we navigated from middle of stack
    if (navHistoryIndex < navHistory.length - 1) {
      navHistory.splice(navHistoryIndex + 1);
    }

    // Avoid pushing identical consecutive locations
    const last = navHistory[navHistory.length - 1];
    if (last && last.file === filePath && last.line === line) return;

    navHistory.push({ file: filePath, line });
    navHistoryIndex = navHistory.length - 1;
    updateHistoryButtons();
  }

  function navigateBack() {
    if (navHistoryIndex > 0) {
      navHistoryIndex--;
      const loc = navHistory[navHistoryIndex];
      isNavigatingHistory = true;
      openFile(loc.file, loc.line, false).finally(() => {
        isNavigatingHistory = false;
        updateHistoryButtons();
      });
    }
  }

  function navigateForward() {
    if (navHistoryIndex < navHistory.length - 1) {
      navHistoryIndex++;
      const loc = navHistory[navHistoryIndex];
      isNavigatingHistory = true;
      openFile(loc.file, loc.line, false).finally(() => {
        isNavigatingHistory = false;
        updateHistoryButtons();
      });
    }
  }

  function updateHistoryButtons() {
    if (btnNavBack) btnNavBack.disabled = navHistoryIndex <= 0;
    if (btnNavForward) btnNavForward.disabled = navHistoryIndex >= navHistory.length - 1;
  }

  if (btnNavBack) btnNavBack.addEventListener('click', navigateBack);
  if (btnNavForward) btnNavForward.addEventListener('click', navigateForward);

  // Keyboard Modifier Listeners (⌘ Cmd on Mac / Ctrl on Windows)
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey) {
      isCmdDown = true;
      if (editorViewport) editorViewport.classList.add('is-cmd-down');
    }
    // Alt + Left: Navigate Back
    if (e.altKey && e.key === 'ArrowLeft') {
      navigateBack();
    }
    // Alt + Right: Navigate Forward
    if (e.altKey && e.key === 'ArrowRight') {
      navigateForward();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (!e.metaKey && !e.ctrlKey) {
      isCmdDown = false;
      if (editorViewport) editorViewport.classList.remove('is-cmd-down');
      hideTooltip();
    }
  });

  window.addEventListener('blur', () => {
    isCmdDown = false;
    if (editorViewport) editorViewport.classList.remove('is-cmd-down');
    hideTooltip();
  });

  // Tooltip & Click Delegation on Code Viewer
  function showTooltip(e, targetFile, targetLine, targetName) {
    if (!defTooltip || !tooltipTarget) return;
    const fileName = targetFile.split('/').pop();
    tooltipTarget.textContent = `${fileName}:${targetLine} (${targetName})`;
    defTooltip.style.left = `${e.clientX + 10}px`;
    defTooltip.style.top = `${e.clientY + 14}px`;
    defTooltip.style.display = 'block';
  }

  function hideTooltip() {
    if (defTooltip) defTooltip.style.display = 'none';
  }

  codeViewer.addEventListener('mouseover', (e) => {
    const clickable = e.target.closest('.nav-clickable');
    if (clickable && isCmdDown) {
      showTooltip(
        e,
        clickable.dataset.targetFile,
        clickable.dataset.targetLine,
        clickable.dataset.targetName
      );
    }
  });

  codeViewer.addEventListener('mousemove', (e) => {
    const clickable = e.target.closest('.nav-clickable');
    if (clickable && isCmdDown) {
      defTooltip.style.left = `${e.clientX + 10}px`;
      defTooltip.style.top = `${e.clientY + 14}px`;
    } else {
      hideTooltip();
    }
  });

  codeViewer.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget || !e.relatedTarget.closest('.nav-clickable')) {
      hideTooltip();
    }
  });

  // Main Click Handler: Command-Click to Navigate
  codeViewer.addEventListener('click', (e) => {
    const clickable = e.target.closest('.nav-clickable');
    if (!clickable) return;

    // Check if modifier key was held
    if (e.metaKey || e.ctrlKey || isCmdDown) {
      e.preventDefault();
      e.stopPropagation();
      hideTooltip();

      const targetFile = clickable.dataset.targetFile;
      const targetLine = parseInt(clickable.dataset.targetLine || '1', 10);

      navigateTo(targetFile, targetLine);
    }
  });

  // Render Tabs Bar
  function renderTabs() {
    editorTabsBar.innerHTML = '';
    openTabs.forEach(tabPath => {
      const meta = projectFiles.find(f => f.path === tabPath);
      if (!meta) return;

      const tabEl = document.createElement('div');
      tabEl.className = `editor-tab ${tabPath === activeFilePath ? 'active' : ''}`;
      tabEl.innerHTML = `
        <span>${meta.name}</span>
        <span class="tab-close" title="Close Tab">&times;</span>
      `;

      tabEl.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-close')) {
          closeTab(tabPath);
        } else {
          navigateTo(tabPath, 1);
        }
      });

      editorTabsBar.appendChild(tabEl);
    });
  }

  function closeTab(tabPath) {
    openTabs = openTabs.filter(p => p !== tabPath);
    if (activeFilePath === tabPath) {
      if (openTabs.length > 0) {
        navigateTo(openTabs[openTabs.length - 1], 1);
      } else {
        activeFilePath = null;
        codeViewer.textContent = '// No file open. Select a file from the explorer on the left.';
        breadcrumbDisplay.textContent = 'RFSmart';
        contextFileDesc.textContent = 'Select a file to inspect its source code.';
      }
    }
    renderTabs();
    updateSidebarActiveState();
  }

  function updateSidebarActiveState() {
    const items = fileTreeContainer.querySelectorAll('.tree-item');
    items.forEach(el => {
      if (el.dataset.path === activeFilePath) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });
  }

  // Search Filter
  fileSearchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim().toLowerCase();
    if (!query) {
      renderFileTree(projectFiles);
      return;
    }

    const filtered = projectFiles.filter(f => 
      f.name.toLowerCase().includes(query) || 
      f.path.toLowerCase().includes(query) ||
      f.category.toLowerCase().includes(query)
    );
    renderFileTree(filtered);
  });

  // Copy Code to Clipboard
  copyCodeBtn.addEventListener('click', async () => {
    if (!currentFileContent) return;
    try {
      await navigator.clipboard.writeText(currentFileContent);
      const originalText = copyCodeBtn.textContent;
      copyCodeBtn.textContent = '✓ Copied!';
      setTimeout(() => {
        copyCodeBtn.textContent = originalText;
      }, 2000);
    } catch (e) {
      console.warn('Clipboard write failed:', e);
    }
  });

  // Toggle API Playground Drawer
  if (drawerBar) {
    drawerBar.addEventListener('click', (e) => {
      if (e.target !== closeDrawerBtn) {
        playgroundDrawer.classList.toggle('collapsed');
      }
    });
  }

  togglePlaygroundBtn.addEventListener('click', () => {
    playgroundDrawer.classList.toggle('collapsed');
  });

  closeDrawerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    playgroundDrawer.classList.add('collapsed');
  });

  // Run Live Barcode Lookup Test
  async function runBarcodeLookup(barcode) {
    if (!barcode) return;
    playgroundDrawer.classList.remove('collapsed');

    resStatusBadge.textContent = 'CALLING...';
    resStatusBadge.className = 'status-chip';
    resLatencyDisplay.textContent = 'Latency: ...';
    resTbaDisplay.textContent = 'TBA: Signing...';
    resBodyDisplay.textContent = `GET /api/scanner/lookup?barcode=${encodeURIComponent(barcode)} ...`;

    const start = Date.now();
    try {
      const res = await fetch(`/api/scanner/lookup?barcode=${encodeURIComponent(barcode)}`);
      const latency = Date.now() - start;
      const data = await res.json();

      resStatusBadge.textContent = res.ok ? '200 OK' : `${res.status} ERR`;
      resStatusBadge.className = `status-chip ${res.ok ? 'success' : 'error'}`;
      resLatencyDisplay.textContent = `Latency: ${latency}ms (${data.source || 'N/A'})`;
      resTbaDisplay.textContent = data.tbaSignature ? `TBA: ${data.tbaSignature.substring(0, 14)}...` : 'TBA: Cached';

      resBodyDisplay.textContent = JSON.stringify(data, null, 2);
    } catch (err) {
      resStatusBadge.textContent = 'ERR';
      resStatusBadge.className = 'status-chip error';
      resLatencyDisplay.textContent = `Latency: ${Date.now() - start}ms`;
      resBodyDisplay.textContent = `Request failed: ${err.message}`;
    }
  }

  runLookupTestBtn.addEventListener('click', () => {
    runBarcodeLookup(testBarcodeInput.value.trim());
  });

  testBarcodeInput.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') {
      runBarcodeLookup(testBarcodeInput.value.trim());
    }
  });

  // Quick Test Chips in Playground
  document.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.barcode;
      testBarcodeInput.value = code;
      runBarcodeLookup(code);
    });
  });

  // Launch initial project loading
  initProject();
});
