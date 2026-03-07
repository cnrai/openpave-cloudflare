#!/usr/bin/env node
/**
 * Cloudflare CLI - Secure Token Version
 * 
 * Uses the PAVE sandbox secure token system for authentication.
 * Tokens are never visible to sandbox code - they're injected by the host.
 * 
 * Token configuration in ~/.pave/permissions.yaml:
 * {
 *   "tokens": {
 *     "cloudflare": {
 *       "env": "CLOUDFLARE_API_TOKEN",
 *       "type": "api_key",
 *       "domains": ["api.cloudflare.com"],
 *       "placement": { "type": "header", "name": "Authorization", "format": "Bearer {token}" }
 *     }
 *   }
 * }
 * 
 * Also requires CLOUDFLARE_ACCOUNT_ID environment variable.
 * 
 * Issue: https://github.com/cnrai/openpave/issues/135
 */

var fs = require('fs');
var path = require('path');

// Parse command line arguments
var args = process.argv.slice(2);

function parseArgs() {
  var parsed = {
    command: null,
    positional: [],
    options: {}
  };

  for (var i = 0; i < args.length; i++) {
    var arg = args[i];

    if (arg.startsWith('-')) {
      if (arg.startsWith('--')) {
        var eqIdx = arg.indexOf('=');
        if (eqIdx !== -1) {
          parsed.options[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
        } else if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          parsed.options[arg.slice(2)] = args[i + 1];
          i++;
        } else {
          parsed.options[arg.slice(2)] = true;
        }
      } else {
        var flag = arg.slice(1);
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          parsed.options[flag] = args[i + 1];
          i++;
        } else {
          parsed.options[flag] = true;
        }
      }
    } else if (!parsed.command) {
      parsed.command = arg;
    } else {
      parsed.positional.push(arg);
    }
  }

  return parsed;
}


// ===================================================================
// Cloudflare API Client
// ===================================================================

function CloudflareClient() {
  this.baseUrl = 'https://api.cloudflare.com/client/v4';
  this.tokenChecked = false;
  this.accountId = null;
}

/**
 * Check if secure token system is available and configured
 */
CloudflareClient.prototype.checkTokens = function() {
  if (this.tokenChecked) return;

  // Check if secure token functions are available
  if (typeof hasToken !== 'function' || typeof authenticatedFetch !== 'function') {
    throw new Error('Secure token system not available. Make sure you are running this via: pave run cloudflare');
  }

  // Check if cloudflare token is configured
  if (!hasToken('cloudflare')) {
    console.error('Cloudflare token not configured.');
    console.error('');
    console.error('Add to ~/.pave/permissions.yaml:');
    console.error(JSON.stringify({
      tokens: {
        cloudflare: {
          env: 'CLOUDFLARE_API_TOKEN',
          type: 'api_key',
          domains: ['api.cloudflare.com'],
          placement: { type: 'header', name: 'Authorization', format: 'Bearer {token}' }
        }
      }
    }, null, 2));
    console.error('');
    console.error('Then set environment variables:');
    console.error('  CLOUDFLARE_API_TOKEN=your_api_token');
    console.error('  CLOUDFLARE_ACCOUNT_ID=your_account_id');
    console.error('');
    throw new Error('Cloudflare token not configured');
  }

  // Get account ID from environment
  this.accountId = typeof getEnv === 'function' ? getEnv('CLOUDFLARE_ACCOUNT_ID') : null;
  if (!this.accountId) {
    // Fallback: try process.env (may not be available in sandbox)
    this.accountId = (typeof process !== 'undefined' && process.env) ? process.env.CLOUDFLARE_ACCOUNT_ID : null;
  }
  if (!this.accountId) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID environment variable is not set');
  }

  this.tokenChecked = true;
};

/**
 * Make an authenticated request to Cloudflare API
 */
CloudflareClient.prototype.request = function(endpoint, options) {
  this.checkTokens();
  options = options || {};

  var url = this.baseUrl + endpoint;

  try {
    var response = authenticatedFetch('cloudflare', url, {
      method: options.method || 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': options.contentType || 'application/json',
        'User-Agent': 'openpave-cloudflare/1.0.0'
      },
      body: options.body || undefined,
      timeout: options.timeout || 30000
    });

    if (!response.ok) {
      var errorData;
      try { errorData = response.json(); } catch (_) { errorData = null; }

      var errMsg = 'HTTP ' + response.status;
      if (errorData && errorData.errors && errorData.errors.length > 0) {
        errMsg = errorData.errors.map(function(e) { return e.message; }).join('; ');
      }
      var error = new Error(errMsg);
      error.status = response.status;
      throw error;
    }

    return response.json();
  } catch (err) {
    if (err.status) throw err;
    throw new Error('Cloudflare API request failed: ' + err.message);
  }
};

/**
 * Make a request with account ID in the path
 */
CloudflareClient.prototype.accountRequest = function(pathStr, options) {
  return this.request('/accounts/' + this.accountId + pathStr, options);
};


// ===================================================================
// Output formatting helpers
// ===================================================================

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  try {
    var d = new Date(dateStr);
    return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z/, ' UTC');
  } catch (_) {
    return dateStr;
  }
}

function truncate(str, max) {
  if (!str) return '';
  if (str.length <= max) return str;
  return str.substring(0, max - 3) + '...';
}

function outputJson(data) {
  console.log(JSON.stringify(data, null, 2));
}


// ===================================================================
// Command: account
// ===================================================================

function cmdAccount(client, opts) {
  var data = client.request('/accounts');

  if (opts.json) {
    outputJson(data);
    return;
  }

  var accounts = data.result || [];
  if (accounts.length === 0) {
    console.log('No accounts found.');
    return;
  }

  console.log('Cloudflare Accounts');
  console.log('============================================================');

  for (var i = 0; i < accounts.length; i++) {
    var acct = accounts[i];
    console.log('');
    console.log('  Name:    ' + acct.name);
    console.log('  ID:      ' + acct.id);
    console.log('  Type:    ' + (acct.type || 'N/A'));
    if (acct.settings) {
      console.log('  Plan:    ' + (acct.settings.default_nameservers || 'N/A'));
    }
    if (acct.created_on) {
      console.log('  Created: ' + formatDate(acct.created_on));
    }
  }

  // Verify token
  var verify = client.request('/user/tokens/verify');
  if (verify.result) {
    console.log('');
    console.log('Token Status');
    console.log('----------------------------------------');
    console.log('  Status:  ' + verify.result.status);
    if (verify.result.expires_on) {
      console.log('  Expires: ' + formatDate(verify.result.expires_on));
    }
  }
}


// ===================================================================
// Command: workers-list
// ===================================================================

function cmdWorkersList(client, opts) {
  var data = client.accountRequest('/workers/scripts');

  if (opts.json) {
    outputJson(data);
    return;
  }

  var scripts = data.result || [];
  if (scripts.length === 0) {
    console.log('No Workers scripts found.');
    return;
  }

  console.log('Workers Scripts (' + scripts.length + ')');
  console.log('============================================================');

  for (var i = 0; i < scripts.length; i++) {
    var script = scripts[i];
    console.log('');
    console.log('  ' + script.id);
    if (script.modified_on) {
      console.log('    Modified: ' + formatDate(script.modified_on));
    }
    if (script.created_on) {
      console.log('    Created:  ' + formatDate(script.created_on));
    }
    if (script.usage_model) {
      console.log('    Usage:    ' + script.usage_model);
    }
    if (script.handlers && script.handlers.length > 0) {
      console.log('    Handlers: ' + script.handlers.join(', '));
    }
  }
}


// ===================================================================
// Command: workers-get
// ===================================================================

function cmdWorkersGet(client, opts, name) {
  if (!name) {
    throw new Error('Worker name is required. Usage: cloudflare workers-get <name>');
  }

  var data = client.accountRequest('/workers/scripts/' + name + '/settings');

  if (opts.json) {
    outputJson(data);
    return;
  }

  var result = data.result || {};
  console.log('Worker: ' + name);
  console.log('============================================================');

  if (result.bindings && result.bindings.length > 0) {
    console.log('');
    console.log('Bindings:');
    for (var i = 0; i < result.bindings.length; i++) {
      var b = result.bindings[i];
      console.log('  - ' + b.name + ' (' + b.type + ')');
    }
  }

  if (result.compatibility_date) {
    console.log('');
    console.log('Compatibility: ' + result.compatibility_date);
  }

  if (result.usage_model) {
    console.log('Usage Model:   ' + result.usage_model);
  }
}


// ===================================================================
// Command: workers-deploy
// ===================================================================

function cmdWorkersDeploy(client, opts, name) {
  if (!name) {
    throw new Error('Worker name is required. Usage: cloudflare workers-deploy <name> --input <file>');
  }

  var inputFile = opts.input || opts.i;
  if (!inputFile) {
    throw new Error('Input file is required. Usage: cloudflare workers-deploy <name> --input worker.js');
  }

  // Resolve and read file
  var filePath = path.resolve(inputFile);
  if (!fs.existsSync(filePath)) {
    throw new Error('File not found: ' + filePath);
  }

  var scriptContent = fs.readFileSync(filePath, 'utf-8');
  var compatDate = opts['compatibility-date'] || new Date().toISOString().slice(0, 10);

  // Detect if the script uses ES modules syntax (export default)
  var isModule = /export\s+default/.test(scriptContent);

  var data;

  if (isModule) {
    // Modules format: use multipart form data
    var metadata = JSON.stringify({
      main_module: 'worker.js',
      compatibility_date: compatDate,
      bindings: []
    });

    // Build multipart form data manually
    var boundary = '----PaveFormBoundary' + Date.now();
    var body = '';
    body += '--' + boundary + '\r\n';
    body += 'Content-Disposition: form-data; name="metadata"; filename="metadata.json"\r\n';
    body += 'Content-Type: application/json\r\n\r\n';
    body += metadata + '\r\n';
    body += '--' + boundary + '\r\n';
    body += 'Content-Disposition: form-data; name="worker.js"; filename="worker.js"\r\n';
    body += 'Content-Type: application/javascript+module\r\n\r\n';
    body += scriptContent + '\r\n';
    body += '--' + boundary + '--\r\n';

    data = client.accountRequest('/workers/scripts/' + name, {
      method: 'PUT',
      contentType: 'multipart/form-data; boundary=' + boundary,
      body: body,
      timeout: 60000
    });
  } else {
    // Service worker format: upload as plain JavaScript
    data = client.accountRequest('/workers/scripts/' + name, {
      method: 'PUT',
      contentType: 'application/javascript',
      body: scriptContent,
      timeout: 60000
    });
  }

  if (opts.json) {
    outputJson(data);
    return;
  }

  if (data.success) {
    var result = data.result || {};
    console.log('Worker deployed successfully!');
    console.log('');
    console.log('  Name:    ' + name);
    console.log('  Format:  ' + (isModule ? 'ES Modules' : 'Service Worker'));
    console.log('  Size:    ' + (scriptContent.length / 1024).toFixed(1) + ' KB');
    console.log('  Compat:  ' + compatDate);
    if (result.modified_on) {
      console.log('  Updated: ' + formatDate(result.modified_on));
    }
  } else {
    console.error('Deployment failed.');
    if (data.errors) {
      for (var i = 0; i < data.errors.length; i++) {
        console.error('  Error: ' + data.errors[i].message);
      }
    }
  }
}


// ===================================================================
// Command: workers-delete
// ===================================================================

function cmdWorkersDelete(client, opts, name) {
  if (!name) {
    throw new Error('Worker name is required. Usage: cloudflare workers-delete <name>');
  }

  if (!opts.force) {
    console.log('Are you sure you want to delete Worker "' + name + '"?');
    console.log('Use --force to confirm deletion.');
    return;
  }

  var data = client.accountRequest('/workers/scripts/' + name, {
    method: 'DELETE'
  });

  if (opts.json) {
    outputJson(data);
    return;
  }

  if (data.success) {
    console.log('Worker "' + name + '" deleted successfully.');
  } else {
    console.error('Failed to delete Worker "' + name + '".');
    if (data.errors) {
      for (var i = 0; i < data.errors.length; i++) {
        console.error('  Error: ' + data.errors[i].message);
      }
    }
  }
}


// ===================================================================
// Command: workers-tail
// ===================================================================

function cmdWorkersTail(client, opts, name) {
  if (!name) {
    throw new Error('Worker name is required. Usage: cloudflare workers-tail <name>');
  }

  var data = client.accountRequest('/workers/scripts/' + name + '/tails', {
    method: 'POST',
    body: JSON.stringify({})
  });

  if (opts.json) {
    outputJson(data);
    return;
  }

  if (data.success && data.result) {
    console.log('Tail created for Worker: ' + name);
    console.log('');
    console.log('  Tail ID:  ' + (data.result.id || 'N/A'));
    console.log('  URL:      ' + (data.result.url || 'N/A'));
    console.log('  Expires:  ' + formatDate(data.result.expires_at));
    console.log('');
    console.log('Note: Real-time tailing requires WebSocket support.');
    console.log('Use the Cloudflare dashboard for real-time logs.');
  } else {
    console.log('Could not create tail for Worker "' + name + '".');
  }
}


// ===================================================================
// Command: workers-subdomain
// ===================================================================

function cmdWorkersSubdomain(client, opts) {
  var data = client.accountRequest('/workers/subdomain');

  if (opts.json) {
    outputJson(data);
    return;
  }

  if (data.result && data.result.subdomain) {
    console.log('Workers Subdomain');
    console.log('========================================');
    console.log('  Subdomain: ' + data.result.subdomain + '.workers.dev');
  } else {
    console.log('No Workers subdomain configured.');
    console.log('Set one in the Cloudflare dashboard.');
  }
}


// ===================================================================
// Command: pages-list
// ===================================================================

function cmdPagesList(client, opts) {
  var data = client.accountRequest('/pages/projects');

  if (opts.json) {
    outputJson(data);
    return;
  }

  var projects = data.result || [];
  if (projects.length === 0) {
    console.log('No Pages projects found.');
    return;
  }

  console.log('Pages Projects (' + projects.length + ')');
  console.log('============================================================');

  for (var i = 0; i < projects.length; i++) {
    var proj = projects[i];
    console.log('');
    console.log('  ' + proj.name);
    console.log('    URL:      https://' + proj.subdomain);
    if (proj.latest_deployment) {
      console.log('    Latest:   ' + formatDate(proj.latest_deployment.created_on));
      console.log('    Status:   ' + (proj.latest_deployment.latest_stage ? proj.latest_deployment.latest_stage.name : 'N/A'));
    }
    if (proj.production_branch) {
      console.log('    Branch:   ' + proj.production_branch);
    }
    if (proj.created_on) {
      console.log('    Created:  ' + formatDate(proj.created_on));
    }
  }
}


// ===================================================================
// Command: pages-get
// ===================================================================

function cmdPagesGet(client, opts, name) {
  if (!name) {
    throw new Error('Project name is required. Usage: cloudflare pages-get <name>');
  }

  var data = client.accountRequest('/pages/projects/' + name);

  if (opts.json) {
    outputJson(data);
    return;
  }

  var proj = data.result;
  if (!proj) {
    console.log('Project not found: ' + name);
    return;
  }

  console.log('Pages Project: ' + proj.name);
  console.log('============================================================');
  console.log('');
  console.log('  URL:        https://' + proj.subdomain);
  console.log('  Branch:     ' + (proj.production_branch || 'N/A'));
  console.log('  Created:    ' + formatDate(proj.created_on));

  if (proj.source && proj.source.config) {
    var src = proj.source.config;
    console.log('');
    console.log('Build Config:');
    if (src.build_command) console.log('  Command:    ' + src.build_command);
    if (src.destination_dir) console.log('  Output:     ' + src.destination_dir);
    if (src.root_dir) console.log('  Root:       ' + src.root_dir);
  }

  if (proj.deployment_configs) {
    console.log('');
    console.log('Deployment Configs:');
    if (proj.deployment_configs.production) {
      var prod = proj.deployment_configs.production;
      if (prod.env_vars) {
        var envKeys = Object.keys(prod.env_vars);
        console.log('  Production env vars: ' + envKeys.length);
      }
    }
  }

  if (proj.latest_deployment) {
    var dep = proj.latest_deployment;
    console.log('');
    console.log('Latest Deployment:');
    console.log('  ID:      ' + dep.id);
    console.log('  Created: ' + formatDate(dep.created_on));
    if (dep.url) console.log('  URL:     ' + dep.url);
    if (dep.latest_stage) {
      console.log('  Stage:   ' + dep.latest_stage.name + ' (' + dep.latest_stage.status + ')');
    }
  }
}


// ===================================================================
// Command: pages-create
// ===================================================================

function cmdPagesCreate(client, opts, name) {
  if (!name) {
    throw new Error('Project name is required. Usage: cloudflare pages-create <name>');
  }

  var body = {
    name: name,
    production_branch: opts['production-branch'] || 'main'
  };

  var data = client.accountRequest('/pages/projects', {
    method: 'POST',
    body: JSON.stringify(body)
  });

  if (opts.json) {
    outputJson(data);
    return;
  }

  if (data.success && data.result) {
    var proj = data.result;
    console.log('Pages project created!');
    console.log('');
    console.log('  Name:    ' + proj.name);
    console.log('  URL:     https://' + proj.subdomain);
    console.log('  Branch:  ' + proj.production_branch);
    console.log('');
    console.log('Deploy with: cloudflare pages-deploy ' + name + ' --directory ./dist');
  } else {
    console.error('Failed to create project.');
    if (data.errors) {
      for (var i = 0; i < data.errors.length; i++) {
        console.error('  Error: ' + data.errors[i].message);
      }
    }
  }
}


// ===================================================================
// Command: pages-deploy (Direct Upload)
// ===================================================================

function cmdPagesDeploy(client, opts, name) {
  if (!name) {
    throw new Error('Project name is required. Usage: cloudflare pages-deploy <name> --directory <dir>');
  }

  var directory = opts.directory || opts.d;
  if (!directory) {
    throw new Error('Directory is required. Usage: cloudflare pages-deploy <name> --directory ./dist');
  }

  var dirPath = path.resolve(directory);
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    throw new Error('Directory not found: ' + dirPath);
  }

  // Collect all files in the directory
  var files = [];
  function walkDir(dir, prefix) {
    var entries = fs.readdirSync(dir);
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var fullPath = path.join(dir, entry);
      var relativePath = prefix ? prefix + '/' + entry : entry;
      var stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walkDir(fullPath, relativePath);
      } else {
        files.push({ path: '/' + relativePath, fullPath: fullPath, size: stat.size });
      }
    }
  }
  walkDir(dirPath, '');

  if (files.length === 0) {
    throw new Error('Directory is empty: ' + dirPath);
  }

  console.log('Deploying ' + files.length + ' files to Pages project "' + name + '"...');

  // Create deployment
  var uploadData = client.accountRequest('/pages/projects/' + name + '/deployments', {
    method: 'POST',
    body: JSON.stringify({
      branch: opts.branch || 'main'
    })
  });

  if (opts.json) {
    outputJson(uploadData);
    return;
  }

  if (uploadData.success && uploadData.result) {
    var dep = uploadData.result;
    console.log('');
    console.log('Deployment created!');
    console.log('');
    console.log('  ID:      ' + dep.id);
    if (dep.url) console.log('  URL:     ' + dep.url);
    console.log('  Created: ' + formatDate(dep.created_on));
    console.log('');
    console.log('Note: Direct file upload for Pages requires the Cloudflare Direct Upload API.');
    console.log('For full directory deployment, use: npx wrangler pages deploy ' + directory);
  } else {
    console.error('Deployment failed.');
    if (uploadData.errors) {
      for (var i = 0; i < uploadData.errors.length; i++) {
        console.error('  Error: ' + uploadData.errors[i].message);
      }
    }
  }
}


// ===================================================================
// Command: pages-deployments
// ===================================================================

function cmdPagesDeployments(client, opts, name) {
  if (!name) {
    throw new Error('Project name is required. Usage: cloudflare pages-deployments <name>');
  }

  var data = client.accountRequest('/pages/projects/' + name + '/deployments');

  if (opts.json) {
    outputJson(data);
    return;
  }

  var deps = data.result || [];
  if (deps.length === 0) {
    console.log('No deployments found for "' + name + '".');
    return;
  }

  console.log('Deployments for "' + name + '" (' + deps.length + ')');
  console.log('============================================================');

  for (var i = 0; i < Math.min(deps.length, 10); i++) {
    var dep = deps[i];
    console.log('');
    console.log('  ' + truncate(dep.id, 20));
    if (dep.url) console.log('    URL:     ' + dep.url);
    console.log('    Created: ' + formatDate(dep.created_on));
    if (dep.latest_stage) {
      console.log('    Stage:   ' + dep.latest_stage.name + ' (' + dep.latest_stage.status + ')');
    }
    if (dep.environment) {
      console.log('    Env:     ' + dep.environment);
    }
  }

  if (deps.length > 10) {
    console.log('');
    console.log('  ... and ' + (deps.length - 10) + ' more. Use --json for full list.');
  }
}


// ===================================================================
// Command: ai-models
// ===================================================================

function cmdAiModels(client, opts) {
  var query = '';
  if (opts.search || opts.s) {
    query += '?search=' + encodeURIComponent(opts.search || opts.s);
  }
  if (opts.task) {
    query += (query ? '&' : '?') + 'task=' + encodeURIComponent(opts.task);
  }

  var data = client.accountRequest('/ai/models/search' + query);

  if (opts.json) {
    outputJson(data);
    return;
  }

  var models = data.result || [];
  if (models.length === 0) {
    console.log('No AI models found.');
    return;
  }

  console.log('AI Models (' + models.length + ')');
  console.log('============================================================');

  for (var i = 0; i < models.length; i++) {
    var model = models[i];
    console.log('');
    console.log('  ' + model.name);
    if (model.task) console.log('    Task:    ' + (model.task.name || model.task));
    if (model.description) console.log('    Desc:    ' + truncate(model.description, 60));
  }
}


// ===================================================================
// Command: ai-run
// ===================================================================

function cmdAiRun(client, opts, model) {
  if (!model) {
    throw new Error('Model name is required. Usage: cloudflare ai-run <model> --prompt "text"');
  }

  var prompt = opts.prompt || opts.p;
  var inputFile = opts.input;

  if (inputFile) {
    var filePath = path.resolve(inputFile);
    if (!fs.existsSync(filePath)) {
      throw new Error('Input file not found: ' + filePath);
    }
    prompt = fs.readFileSync(filePath, 'utf-8');
  }

  if (!prompt) {
    throw new Error('Prompt is required. Usage: cloudflare ai-run <model> --prompt "text"');
  }

  // Normalize model name (allow short names like @cf/meta/llama-3-8b-instruct)
  if (!model.startsWith('@')) {
    model = '@cf/' + model;
  }

  var body = JSON.stringify({
    messages: [
      { role: 'user', content: prompt }
    ]
  });

  var data = client.accountRequest('/ai/run/' + model, {
    method: 'POST',
    body: body,
    timeout: 60000
  });

  if (opts.json) {
    outputJson(data);
    return;
  }

  if (data.result) {
    var result = data.result;
    if (result.response) {
      console.log(result.response);
    } else if (typeof result === 'string') {
      console.log(result);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } else {
    console.error('No result from AI model.');
    if (data.errors) {
      for (var i = 0; i < data.errors.length; i++) {
        console.error('  Error: ' + data.errors[i].message);
      }
    }
  }
}


// ===================================================================
// Main entry point
// ===================================================================

function main() {
  var parsed = parseArgs();
  var client = new CloudflareClient();

  if (!parsed.command) {
    console.log('Cloudflare CLI - Deploy and manage Workers, Pages, and AI');
    console.log('');
    console.log('Commands:');
    console.log('  account              Show account info');
    console.log('');
    console.log('  workers-list         List Workers scripts');
    console.log('  workers-get <name>   Get Worker details');
    console.log('  workers-deploy <n>   Deploy a Worker from file');
    console.log('  workers-delete <n>   Delete a Worker');
    console.log('  workers-tail <name>  Get Worker logs');
    console.log('  workers-subdomain    Get Workers subdomain');
    console.log('');
    console.log('  pages-list           List Pages projects');
    console.log('  pages-get <name>     Get project details');
    console.log('  pages-create <name>  Create a Pages project');
    console.log('  pages-deploy <name>  Deploy to Pages');
    console.log('  pages-deployments    List deployments');
    console.log('');
    console.log('  ai-models            List AI models');
    console.log('  ai-run <model>       Run an AI model');
    console.log('');
    console.log('Options:');
    console.log('  --json               Output raw JSON');
    console.log('  --summary            Brief output');
    console.log('');
    console.log('Examples:');
    console.log('  cloudflare account');
    console.log('  cloudflare workers-list');
    console.log('  cloudflare workers-deploy my-worker --input worker.js');
    console.log('  cloudflare pages-create my-site');
    console.log('  cloudflare ai-run @cf/meta/llama-3-8b-instruct --prompt "Hello"');
    return;
  }

  var name = parsed.positional[0];

  switch (parsed.command) {
    case 'account':
      cmdAccount(client, parsed.options);
      break;
    case 'workers-list':
      cmdWorkersList(client, parsed.options);
      break;
    case 'workers-get':
      cmdWorkersGet(client, parsed.options, name);
      break;
    case 'workers-deploy':
      cmdWorkersDeploy(client, parsed.options, name);
      break;
    case 'workers-delete':
      cmdWorkersDelete(client, parsed.options, name);
      break;
    case 'workers-tail':
      cmdWorkersTail(client, parsed.options, name);
      break;
    case 'workers-subdomain':
      cmdWorkersSubdomain(client, parsed.options);
      break;
    case 'pages-list':
      cmdPagesList(client, parsed.options);
      break;
    case 'pages-get':
      cmdPagesGet(client, parsed.options, name);
      break;
    case 'pages-create':
      cmdPagesCreate(client, parsed.options, name);
      break;
    case 'pages-deploy':
      cmdPagesDeploy(client, parsed.options, name);
      break;
    case 'pages-deployments':
      cmdPagesDeployments(client, parsed.options, name);
      break;
    case 'ai-models':
      cmdAiModels(client, parsed.options);
      break;
    case 'ai-run':
      cmdAiRun(client, parsed.options, name);
      break;
    default:
      console.error('Unknown command: ' + parsed.command);
      console.error('Run without arguments to see available commands.');
      process.exit(1);
  }
}

try {
  main();
} catch (err) {
  console.error('Error: ' + err.message);
  process.exit(1);
}
