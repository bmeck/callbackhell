var traverse = require('ast-traverse');

exports.ScopeChain = ScopeChain;

ScopeChain.fromAST = function (ast) {
  // global scope
  var root = new ScopeChain(null, null, ScopeChain.SCOPE_TYPE.GLOBAL);
  var current_scope = root;
  // we make one pass to build all declarations and references
  // no hoisting occurs
  traverse(ast, {
    pre: function (node, parent) {
      node.$parent = parent;
      if (node.type === 'CallExpression') {
        // find direct evals
        if (node.callee.type === 'Identifier') {
          if (node.callee.name === 'eval') {
            current_scope.eval_at(node);
          }
        }
        else {
          if (node.callee.object.type === 'Identifier') {
            current_scope.reference(node.callee.object.name, node);
          }
          current_scope.call_at(node);
        }
      }
      else if (node.type === 'Program') {
        current_scope = current_scope.child(node, null, ScopeChain.SCOPE_TYPE.GLOBAL);
      }
      else if (node.type === 'WithStatement') {
        current_scope = current_scope.child(node, null, ScopeChain.SCOPE_TYPE.WITH);
      }
      else if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') {
        var vars = ['this', 'arguments'].concat(node.params.map(function (param) {
          return param.name 
        }));
        if (node.id) {
          vars.push(node.id.name)
        }
        if (node.type === 'FunctionDeclaration') {
          current_scope.declare(node.id.name, node, ScopeChain.DECLARATION_TYPE.VAR);
        }
        current_scope = current_scope.child(node, vars, ScopeChain.SCOPE_TYPE.FUNCTION);
      }
      else if (node.type === 'CatchClause') {
        current_scope = current_scope.child(node, [node.param.name], ScopeChain.SCOPE_TYPE.CATCH);
      }
      else if (node.type === 'VariableDeclarator') {
        if (parent.kind === 'var') {
          current_scope.declare(node.id.name, node, ScopeChain.DECLARATION_TYPE.VAR);
        }
        else if (parent.kind === 'let') {
          current_scope.declare(node.id.name, node, ScopeChain.DECLARATION_TYPE.LET);
        }
        else if (parent.kind === 'const') {
          current_scope.declare(node.id.name, node, ScopeChain.DECLARATION_TYPE.LET);
        }
        else {
          throw new Error('Unknown variable declaration ' + parent.kind);
        }
      }
      else if (node.type === 'Identifier') {
        var exempt = ['CatchClause', 'FunctionDeclaration', 'VariableDeclarator', 'FunctionExpression'];
        if (!in_arr(exempt)(parent.type)) {
         current_scope.reference(node.name, node);
        }
      }
      // places where scope can only be changed by inner scopes
      else if (node.type === 'ThrowStatement') {
        current_scope.throw_at(node);
      }
      else if (node.type === 'ReturnStatement') {
        current_scope.return_at(node);
      }
      else if (node.type === 'BreakStatement') {
        // TODO this needs to encompass labelled breaks
        current_scope.break_at(node);
      }
      else if (node.type === 'ContinueStatement') {
        // TODO this needs to encompass labelled breaks
        current_scope.continue_at(node);
      }
      else {
        // technically this will add block scope to things like Literal and ReturnStatement
        // but no harm is done if it actually parses
        var exempt = ['VariableDeclaration', 'File', 'Literal'];
        var parent_exempt = ['FunctionDeclaration', 'FunctionExpression'];
        if ((!node.$parent || !in_arr(parent_exempt)(node.$parent.type)) && !in_arr(exempt)(node.type)) {
          // console.log('ADDING BLOCK SCOPE FOR', node.type, exempt)
          current_scope = current_scope.child(node, [], ScopeChain.SCOPE_TYPE.BLOCK);
        }
      }
    },
    post: function (node, parent, prop, index) {
      if (current_scope.node !== node) {
        return;
      }
      current_scope = current_scope.parent;
    }
  });
  
  return root;
}

function in_arr(arr) {
  return function (v) {
    return arr.indexOf(v) !== -1;
  }
}
function on_obj(obj) {
  return function (k) {
    return Object.prototype.hasOwnProperty.call(obj, k);
  }
}

var SCOPE_TYPE = ScopeChain.SCOPE_TYPE = {
  GLOBAL:   "GLOBAL",
  WITH:     "WITH",
  FUNCTION: "FUNCTION",
  CATCH:    "CATCH",
  BLOCK:    "BLOCK"
}
var DECLARATION_TYPE = ScopeChain.DECLARATION_TYPE = {
  VAR:   "VAR",
  CATCH: "CATCH",
  LET:   "LET"
}

// Used to aggregate list of scopes, references, and originating nodes
// THIS IS NOT USED TO INVESTIGATE / AGGREGATE COMPUTED STATE
function ScopeChain(node, init, type, parent) {
  this.node = node;
  this.parent = parent || null;
  this.children = [];
  this.scope = null;
  this.vars = {};
  if (init) init.forEach(function (key) {
    this.vars[key] = [node];
  }, this);
  this.init = init || [];
  this.refs = {};
  this.calls = []; // closure leak
  this.returns = []; // closure leak, GC
  this.throws = []; // GC
  this.breaks = []; // GC
  this.continues = []; // ?
  this.evals = []; // closure bind
  this.type = type || SCOPE_TYPE.FUNCTION;
  return this;
}
ScopeChain.prototype.shadows = function (name) {
  var scope = this;
  while (scope) {
    if (on_obj(scope.vars)(name)) {
      return true;
    }
    scope = scope.parent;
  }
  return false;
}
ScopeChain.prototype.return_at = function (node) {
  var scope = this;
  while (scope) {
    if (!in_arr(scope.returns)(node)) scope.returns.push(node);
    if (scope.type === SCOPE_TYPE.FUNCTION || scope.type === SCOPE_TYPE.GLOBAL) {
      return;
    }
    scope = scope.parent;
  }
}
ScopeChain.prototype.break_at = function (node) {
  var scope = this;
  while (scope) {
    if (!in_arr(scope.breaks)(node)) scope.breaks.push(node);
    if (scope.type === SCOPE_TYPE.BLOCK) {
      if (node.label) {
        if (this.node.$parent.type === 'LabeledStatement' && this.node.$parent.label.name === node.label.name) {
          return;
        }
      }
      else {
        return;
      }
    }
    else {
      throw new Error('invalid break, attempting to cross boundary of scope with type ' + scope.type)
    }
    scope = scope.parent;
  }
}
ScopeChain.prototype.continue_at = function (node) {
  var scope = this;
  while (scope) {
    if (!in_arr(scope.continues)(node)) scope.continues.push(node);
    if (scope.type === SCOPE_TYPE.BLOCK) {
      if (node.label) {
        if (this.node.$parent.type === 'LabeledStatement' && this.node.$parent.label.name === node.label.name) {
          return;
        }
      }
      else {
        return;
      }
    }
    else {
      throw new Error('invalid break, attempting to cross boundary of scope with type ' + scope.type)
    }
    scope = scope.parent;
  }
}
ScopeChain.prototype.throw_at = function (node) {
  var scope = this;
  while (scope) {
    if (!in_arr(scope.throws)(node)) scope.throws.push(node);
    if (scope.type === SCOPE_TYPE.FUNCTION || scope.type === SCOPE_TYPE.GLOBAL) {
      return;
    }
    scope = scope.parent;
  }
}
ScopeChain.prototype.eval_at = function (node) {
  if (this.shadows('eval')) {
    return;
  }
  var scope = this;
  while (scope) {
    scope.evals.push(node);
    scope = scope.parent;
  }
}
ScopeChain.prototype.call_at = function (node) {
  this.calls.push(node);
}
ScopeChain.prototype.child = function (node, init, type) {
  var child = new ScopeChain(node, init, type, this);
  this.children.push(child);
  return child;
}
ScopeChain.prototype.declare = function (name, node, type) {
  var scope = this;
  while (scope) {
    if (type === DECLARATION_TYPE.VAR) {
      if (scope.type === SCOPE_TYPE.GLOBAL || scope.type === SCOPE_TYPE.FUNCTION) {
        break;
      }
    }
    if (type === DECLARATION_TYPE.CATCH) {
      if (scope.type === SCOPE_TYPE.CATCH) {
        break;
      }
    }
    if (type === DECLARATION_TYPE.LET) {
      if (scope.type === SCOPE_TYPE.GLOBAL || scope.type === SCOPE_TYPE.FUNCTION || scope.type === SCOPE_TYPE.BLOCK) {
        // console.log('LET RESOLVED TO ', scope.node)
        break;
      }
    }
    scope = scope.parent;
  }
  if (scope) {
    if (!on_obj(scope.vars)(name)) {
      scope.vars[name] = [node];
    }
    else {
      scope.vars[name].push(node);
    }
  }
  else {
    console.log(name, type)
    throw new Error('Invalid variable declaration type, no suitable scope container');
  }
}
ScopeChain.prototype.reference = function (name, node) {
  if (!on_obj(this.refs)(name)) {
    this.refs[name] = [node];
  }
  else {
    this.refs[name].push(node);
  }
}