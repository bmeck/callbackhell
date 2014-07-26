function grand_parent(err, grand_parent_argument) {
  function parent_independant() {
    return 2;
  }
  (function parent_expression() {})
  function parent_shadowing(err) {}
  function parent_sibling_dependant() {
    parent_dependant;
  }
  function parent_dependant_on_argument() {
    grand_parent_argument;
  }
  function parent_dependant_in_if() {
    if (function () {grand_parent_argument}) {}
  }
  function parent_dependant_in_for() {
    for (var x in function () {grand_parent_argument}) {}
  }
  function parent_shadowed_in_for() {
    for (var grand_parent_argument in function () {grand_parent_argument}) {}
  }
  function parent() {
    function child(args) {
    }
    child();
  }
}
with ({}) { 
  function ruined_by_with() {
    outer();
  }
  function shadowing_with_dependency(outer) {
    outer();
  }
}
function parent_of_eval() {
  function ruined_by_eval() {
    eval()
  }
  function not_eval_dependant_on_parent() {
    parent_of_eval.eval()
  }
  function not_eval_obj() {
    ({}).eval()
  }
  function not_eval_inner() {
    not_eval_inner.eval()
  }
  function shadowed_eval(eval) {
    eval();
  }
}

if (test) {
  function in_if() {
  }
}

if (true) {
  const block_scope = true;
  function dependant_on_block_scope() {
    block_scope;
  }
}

if (test_throw_cleanup) throw 456;
if (test_throw_block_cleanup) {
  let cascading_cleanup = 123;
  throw 456;
}
function test_throw_fn_cleanup() {
  var limited_cleanup = 123;
  throw 456;
}
