//
// USAGE: callbackhell.js file.js > unnested.js
//
// TODO: why is recast freaking out about source maps!?
// TODO: leak in optimization for eval / with shadowing
//

exports.hoist = callbackHoist;

var traverse = require('ast-traverse');

function not(fn) {
  return function _not(v) {
    return !Boolean(fn(v));
  }
}
function in_arr(arr) {
  return function (v) {
    return arr.indexOf(v) !== -1;
  }
}

var SCOPE_TYPE = {
  GLOBAL:   "GLOBAL",
  WITH:     "WITH",
  FUNCTION: "FUNCTION",
  CATCH:    "CATCH",
  BLOCK:    "BLOCK"
}
var DECLARATION_TYPE = {
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
  this.vars = Array.isArray(init) ? init.map(String) : init == null ? [] : [String(init)];
  this.refs = [];
  this.evals = [];
  this.type = type || SCOPE_TYPE.FUNCTION;
  return this;
}
ScopeChain.prototype.shadows = function (name) {
  var scope = this;
  while (scope) {
    if (in_arr(scope.vars)(name)) {
      return true;
    }
    scope = scope.parent;
  }
  return false;
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
ScopeChain.prototype.child = function (node, init, type) {
  var child = new ScopeChain(node, init, type, this);
  this.children.push(child);
  return child;
}
ScopeChain.prototype.declare = function (name, type) {
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
    if (!in_arr(scope.vars)(name)) {
      scope.vars.push(name);
    }
    else {
      throw new Error('Double declaration');
    }
  }
  else {
    throw new Error('Invalid variable declaration type, no suitable scope container');
  }
}
ScopeChain.prototype.reference = function (name) {
  if (!in_arr(this.refs)(name)) this.refs.push(name);
}

// Used to handle COMPUTED STATE when we try to figure out what references are
// unresolved in a ScopeChain; used as a cache, would need to be recomputed
// if you moved things around and wanted up to date data (post traversals can
// mostly avoid this if you are careful)
function OuterRefChain(scope_chain, parent) {
  this.parent = parent;
  this.scope = scope_chain;
  this.children = this.scope.children.map(function (scope) {
    return new OuterRefChain(scope, this);
  }, this);
  this.outer_refs = this._outerReferences();
  return this;
}
OuterRefChain.prototype._outerReferences = function () {
  var not_declared_here = not(in_arr(this.scope.vars));
  var refs = this.children.reduce(function (refs, child) {
    var new_refs = child.outer_refs
      .filter(not_declared_here)
      .filter(not(in_arr(refs)));
    refs.push.apply(refs, new_refs);
    return refs;
  }, this.scope.refs.filter(not_declared_here));
  return refs;
}

//
// Terrible code but works
//
function callbackHoist(ast, cb) {
  // global scope
  var root = new ScopeChain(null, null, SCOPE_TYPE.GLOBAL);
  var current_scope = root;
  // we make one pass to build all declarations and references
  // no hoisting occurs
  traverse(ast, {
    pre: function (node, parent) {
      node.$parent = parent;
      if (node.type === 'CallExpression') {
        // find direct evals
        if (node.callee.type === 'Identifier' && node.callee.name === 'eval') {
          current_scope.eval_at(node);
        }
      }
      else if (node.type === 'Program') {
        current_scope = current_scope.child(node, null, SCOPE_TYPE.GLOBAL);
      }
      else if (node.type === 'WithStatement') {
        current_scope = current_scope.child(node, null, SCOPE_TYPE.WITH);
      }
      else if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') {
        var vars = ['this', 'arguments'].concat(node.params.map(function (param) {
          return param.name 
        }));
        if (node.id) {
          vars.push(node.id.name)
        }
        if (node.type === 'FunctionDeclaration') {
          current_scope.declare(node.id.name, DECLARATION_TYPE.VAR);
        }
        current_scope = current_scope.child(node, vars, SCOPE_TYPE.FUNCTION);
      }
      else if (node.type === 'CatchClause') {
        current_scope = current_scope.child(node, [node.param.name], SCOPE_TYPE.CATCH);
      }
      else if (node.type === 'VariableDeclarator') {
        if (parent.kind === 'var') {
          current_scope.declare(node.id.name, DECLARATION_TYPE.VAR);
        }
        else if (parent.kind === 'let') {
          current_scope.declare(node.id.name, DECLARATION_TYPE.LET);
        }
        else {
          throw new Error('Unknown variable declaration ' + parent.kind);
        }
      }
      else if (node.type === 'Identifier') {
        var exempt = ['CatchClause', 'FunctionDeclaration', 'VariableDeclarator', 'FunctionExpression'];
        if (!in_arr(exempt)(parent.type)) {
         current_scope.reference(node.name);
        }
      }
      else {
        // technically this will add block scope to things like Literal and ReturnStatement
        // but no harm is done if it actually parses
        var exempt = ['VariableDeclaration', 'File', 'Literal', 'ReturnStatement', 'ThrowStatement'];
        if (!in_arr(exempt)(node.type)) {
          // console.log('ADDING BLOCK SCOPE FOR', node.type, exempt)
          current_scope = current_scope.child(node, [], SCOPE_TYPE.BLOCK);
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
  
  // our walk function, used for the actual transformation part of things
  
  function walk(outer_chain) {
    // doing post traversal
    outer_chain.children.forEach(walk);
    var scope = outer_chain.scope;
    if (scope && scope.evals.length === 0) {
      // can be hoisted
      var var_container;
      var container = scope.parent;
      // we need a function
      // it needs a name
      if (container && scope.type === SCOPE_TYPE.FUNCTION && scope.node.id) {
        var outer_refs = outer_chain.outer_refs;
        while (container) {
          // we have found the container that we are dependant on
          // console.log(scope.node.id.name, container.type);
          if (container.vars.some(in_arr(outer_refs))) {
            // console.log(scope.node.id.name, 'BLOCKED BY', container.vars.filter(in_arr(outer_refs)), container.type)
            break;
          }
          if ((outer_refs.length && container.type === SCOPE_TYPE.WITH)) {
            // console.log(scope.node.id.name, 'BLOCKED BY WITH()')
            break;
          }
          if ((container.type === SCOPE_TYPE.FUNCTION || container.type === SCOPE_TYPE.GLOBAL) && container.node) {
            var_container = container;
          }
          container = container.parent;
        }
        if (var_container) {
          var body = var_container.node && var_container.node.body;
          if (body) {
            body = body.body || body;
            body.unshift(scope.node);
            function replace(value, remove) {
              var keys = Object.keys(scope.node.$parent).filter(function (k) {
                return scope.node.$parent[k] === scope.node;
              });
              if (keys.length !== 0) {
                if (remove) {
                  delete scope.node.$parent[keys[0]];
                }
                else {
                  scope.node.$parent[keys[0]] = value;
                }
              }
              else if (scope.node.$parent.body) {
                var index = scope.node.$parent.body.indexOf(scope.node);
                if (index !== -1) {
                  if (remove) {
                    scope.node.$parent.body.splice(index, 1);
                  }
                  else {
                    scope.node.$parent.body.splice(index, 1, value);
                  }
                  return;
                }
                throw new Error('UNABLE TO REPLACE!?');
              }
            }
            if (scope.node.type === 'FunctionExpression') {
              scope.node.type = 'FunctionDeclaration';
              replace({type: 'Identifier', name: scope.node.id.name});
            }
            else {
              replace(null, true);
            }
          }
        }
      }
    }
  }
  walk(new OuterRefChain(root));
  // we crawl our scopes to check for hoisting
  return ast;
}