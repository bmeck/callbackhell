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
    x();
  }
  function shadowing_with_dependency(x) {
    x();
  }
}
function parent_of_eval() {
  function ruined_by_eval() {
    eval()
  }
  function not_eval() {
    x.eval()
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
  let block_scope = true;
  function dependant_on_block_scope() {
    block_scope;
  }
}
