//
// USAGE: callbackhell.js file.js > unnested.js
//
// TODO: why is recast freaking out about source maps!?
// TODO: leak in optimization for eval / with shadowing
//

exports.hoist = callbackHoist;

var ScopeChain = require('./ScopeChain').ScopeChain;

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
function on_obj(obj) {
  return function (k) {
    return Object.prototype.hasOwnProperty.call(obj, k);
  }
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
  this.held_variables = this._heldVariables();
  return this;
}
OuterRefChain.prototype._outerReferences = function () {
  var not_declared_here = not(on_obj(this.scope.vars));
  var $this = this;
  return this.children.reduce(function (refs, child) {
    var child_ref_names = Object.keys(child.outer_refs);
    var new_refs = child_ref_names
      .filter(not_declared_here)
    return new_refs.reduce(function (refs, key) {
      if (on_obj(refs)(key)) {
        refs[key].push.apply(refs[key], child.outer_refs[key]);
      }
      else {
        refs[key] = child.outer_refs[key].concat();
      }
      //console.log('REFS', refs)
      return refs;
    }, refs);
  }, Object.keys($this.scope.refs).reduce(function (refs, key) {
    refs[key] = $this.scope.refs[key].concat();
    return refs;
  }, {}));
}
// find all variables that no other scope is holding and we own
OuterRefChain.prototype._heldVariables = function () {
  var $this = this;
  var held = Object.keys(this.scope.vars).filter(function (name) {
    return $this.children.length === 0 || !$this.children.some(function (child) {
      if (name === 'limited_cleanup') {
      }
      return on_obj(child.outer_refs)(name);
    })
  });
  return held;
}

//
// Terrible code but works
//
function callbackHoist(ast, cb) {
  
  // our walk function, used for the actual transformation part of things
  var root = ScopeChain.fromAST(ast);
  
  function walk(outer_chain) {
    // doing post traversal
    outer_chain.children.forEach(walk);
    var scope = outer_chain.scope;
    if (scope.throws.length) {
      scope.throws.forEach(function (throwing_node) {
        // TODO: the cleanup
        // console.log('COULD CLEANUP', outer_chain.held_variables.filter(function (name) {
          // // don't cleanup init intrinsics
          // return !in_arr(outer_chain.scope.init)(name)
        //}), scope.type, scope.node.id && scope.node.id.name, scope.node.type, 'from', throwing_node.loc)
      });
    }
    if (scope && scope.evals.length === 0) {
      // can be hoisted
      var var_container;
      var container = scope.parent;
      // we need a function
      // it needs a name
      if (container && scope.type === ScopeChain.SCOPE_TYPE.FUNCTION && scope.node.id) {
        var outer_refs = outer_chain.outer_refs;
        while (container) {
          // we have found the container that we are dependant on
          // console.log(scope.node.id.name, container.type);
          if (Object.keys(container.vars).some(on_obj(outer_refs))) {
            // console.log(scope.node.id.name, 'BLOCKED BY', container.vars.filter(in_arr(outer_refs)), container.type)
            break;
          }
          if ((Object.keys(outer_refs).length && container.type === ScopeChain.SCOPE_TYPE.WITH)) {
            // console.log(scope.node.id.name, 'BLOCKED BY WITH()')
            break;
          }
          if ((container.type === ScopeChain.SCOPE_TYPE.FUNCTION || container.type === ScopeChain.SCOPE_TYPE.GLOBAL) && container.node) {
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