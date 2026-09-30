/**
 * RF-SMART Code Studio - Client Engine
 * 
 * Manages project tree navigation, file tabs, syntax-highlighted code rendering,
 * and live API testing.
 */

document.addEventListener('DOMContentLoaded', () => {
  let projectFiles = [];
  let openTabs = [];
  let activeFilePath = null;
  let currentFileContent = '';

  // Elements
  const fileTreeContainer = document.getElementById('fileTreeContainer');
  const filesCountBadge = document.getElementById('filesCountBadge');
  const fileSearchInput = document.getElementById('fileSearchInput');
  const editorTabsBar = document.getElementById('editorTabsBar');
  const breadcrumbDisplay = document.getElementById('breadcrumbDisplay');
  const contextLayerBadge = document.getElementById('contextLayerBadge');
  const contextFileName = document.getElementById('contextFileName');
  const contextFileDesc = document.getElementById('contextFileDesc');
  const codeViewer = document.getElementById('codeViewer');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const copyCodeBtn = document.getElementById('copyCodeBtn');

  // Playground Elements
  const playgroundDrawer = document.getElementById('playgroundDrawer');
  const togglePlaygroundBtn = document.getElementById('togglePlaygroundBtn');
  const closeDrawerBtn = document.getElementById('closeDrawerBtn');
  const testBarcodeInput = document.getElementById('testBarcodeInput');
  const runLookupTestBtn = document.getElementById('runLookupTestBtn');
  const resStatusBadge = document.getElementById('resStatusBadge');
  const resLatencyDisplay = document.getElementById('resLatencyDisplay');
  const resTbaDisplay = document.getElementById('resTbaDisplay');
  const resBodyDisplay = document.getElementById('resBodyDisplay');

  // Fetch project tree from server
  async function initProject() {
    try {
      const response = await fetch('/api/ide/files');
      const data = await response.json();
      if (data.success && data.files) {
        projectFiles = data.files;
        filesCountBadge.textContent = `${projectFiles.length} files`;
        renderFileTree(projectFiles);

        // Open a foundational backend file by default: server/services/auth.js
        const defaultFile = projectFiles.find(f => f.path === 'server/services/auth.js') || projectFiles[0];
        if (defaultFile) {
          openFile(defaultFile.path);
        }
      }
    } catch (err) {
      console.error('Failed to load project files:', err);
      breadcrumbDisplay.textContent = 'Error connecting to RF-SMART backend on port 7370';
    }
  }

  // Render Sidebar Tree
  function renderFileTree(files) {
    fileTreeContainer.innerHTML = '';

    // Group files by category
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

        itemEl.addEventListener('click', () => openFile(f.path));
        groupEl.appendChild(itemEl);
      }

      fileTreeContainer.appendChild(groupEl);
    }
  }

  // Open file in Editor
  async function openFile(filePath) {
    const fileMeta = projectFiles.find(f => f.path === filePath);
    if (!fileMeta) return;

    activeFilePath = filePath;

    // Add to open tabs if not present
    if (!openTabs.includes(filePath)) {
      openTabs.push(filePath);
    }

    renderTabs();
    updateSidebarActiveState();

    // Show loading indicator
    loadingOverlay.classList.add('visible');

    try {
      const response = await fetch(`/api/ide/file?path=${encodeURIComponent(filePath)}`);
      const data = await response.json();

      if (data.success && data.file) {
        const file = data.file;
        currentFileContent = file.content;

        // Update Breadcrumb & Context Card
        if (breadcrumbDisplay) breadcrumbDisplay.textContent = `RFSmart > ${file.path.replace(/\//g, ' > ')}`;
        if (contextLayerBadge) {
          contextLayerBadge.textContent = file.layer;
          contextLayerBadge.className = `info-layer badge-${file.layer.toLowerCase()}`;
        }
        if (contextFileName) contextFileName.textContent = file.name;
        if (contextFileDesc) contextFileDesc.textContent = file.description;

        // Set Code Content
        codeViewer.className = `language-${file.language}`;
        codeViewer.textContent = file.content;

        // Trigger Prism syntax highlighting
        if (window.Prism) {
          Prism.highlightElement(codeViewer);
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
          openFile(tabPath);
        }
      });

      editorTabsBar.appendChild(tabEl);
    });
  }

  function closeTab(tabPath) {
    openTabs = openTabs.filter(p => p !== tabPath);
    if (activeFilePath === tabPath) {
      if (openTabs.length > 0) {
        openFile(openTabs[openTabs.length - 1]);
      } else {
        activeFilePath = null;
        codeViewer.textContent = '// No file open. Select a file from the explorer on the left.';
        breadcrumbDisplay.textContent = 'RFSmart';
        contextFileName.textContent = 'No file open';
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
  const drawerBar = document.getElementById('drawerBar');
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
    resStatusBadge.className = 'res-badge';
    resLatencyDisplay.textContent = 'Latency: ...';
    resTbaDisplay.textContent = 'TBA: Signing...';
    resBodyDisplay.textContent = `GET /api/scanner/lookup?barcode=${encodeURIComponent(barcode)} ...`;

    const start = Date.now();
    try {
      const res = await fetch(`/api/scanner/lookup?barcode=${encodeURIComponent(barcode)}`);
      const latency = Date.now() - start;
      const data = await res.json();

      resStatusBadge.textContent = res.ok ? '200 OK' : `${res.status} ERR`;
      resStatusBadge.className = `res-badge ${res.ok ? 'success' : 'error'}`;
      resLatencyDisplay.textContent = `Latency: ${latency}ms (${data.source || 'N/A'})`;
      resTbaDisplay.textContent = data.tbaSignature ? `TBA: ${data.tbaSignature.substring(0, 14)}...` : 'TBA: Cached';

      resBodyDisplay.textContent = JSON.stringify(data, null, 2);
    } catch (err) {
      resStatusBadge.textContent = 'ERR';
      resStatusBadge.className = 'res-badge error';
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

  // Quick Test Buttons in Playground
  document.querySelectorAll('.btn-quick-test').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.barcode;
      testBarcodeInput.value = code;
      runBarcodeLookup(code);
    });
  });

  // Initialize
  initProject();
});
