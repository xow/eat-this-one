angular.module('eat-this-one').controller('indexController', ['$scope', '$window', function($scope, $window) {

    $scope.pageTitle = 'Eat-this-one';
    $scope.lang = $.eatLang[$.eatConfig.lang];

    $scope.where = {
        name: 'where',
        label: $scope.lang.where,
        placeholder: $scope.lang.where,
    };
    $scope.when = {
        name: 'when',
        label: $scope.lang.when,
        placeholder: $scope.lang.when,
    };

    $scope.wheremodel = '';
    var params = '';
    var wherevalue = $('#id-where').val();
    var whenvalue = $('#id-when').val();

    if (wherevalue != "") {
        params = '?where=' + wherevalue;
    }
    if (whenvalue != "") {
        if (params != '') {
            params += '&when=' + whenvalue;
        } else {
            params = '?when=' + whenvalue;
        }
    }

    $scope.searchDish = function() {
        $window.location.href = '/dishes/index.html' + params;
    };

    $scope.addDish = function() {
        $window.location.href = '/dishes/edit.html' + params;
    };
}]);