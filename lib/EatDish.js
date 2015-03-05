var DishModel = require('../models/dish.js').model;
var PhotoModel = require('../models/photo.js').model;

function EatDish(eat) {

    this.eat = eat;
    this.attrs = {
        id : {
            validation : ['isNotEmpty', 'isMongoId']
        },
        user : {
            validation : ['isNotEmpty', 'isMongoId']
        },
        locationid : {
            validation : ['isNotEmpty', 'isMongoId']
        },
        photo : {
            validation : ['isBase64']
        },
        name : {
            validation : ['isNotEmpty', 'matches'],
            pattern : this.eat.getStringRegEx()
        },
        description : {
            validation : ['matches'],
            pattern : this.eat.getStringRegEx()
        },
        when : {
            validation : ['isNotEmpty', 'isNumeric']
        },
        nportions : {
            validation : ['isNotEmpty', 'isNumeric']
        },
        donation : {
            validation : ['isNotEmpty', 'isAlphanumeric']
        }
    };
}

/**
 * This only returns basic dish data.
 */
EatDish.prototype.getByUser = function() {

    var subscriptionsFilters = {userid : this.eat.getUserid()};

    // Here we will get all dishes from the user location subscriptions.
    var subscriptionsCallback = function(error, subscriptions) {
        if (error) {
            return this.eat.returnCallback(error);
        }

        // As long as the user has an account it is an user so this is a 200.
        if (subscriptions.length === 0) {
            return this.eat.returnCallback(null, [], 200);
        }

        // In theory just 1 location subscription per user, but let's do
        // it for multiple locations as we will need it at some point.
        var locationIds = [];
        subscriptions.forEach(function(subscription) {
            locationIds.push(subscription.locationid);
        });

        // Fetch by location id and return them.
        var filters = {
            loc : {
                $in : locationIds
            }, when : {
                $gt : this.eat.getYesterday()
            }
        };
        this.fetch(filters);

    }.bind(this);

    this.eat.getEatLocationSubscription().fetch(subscriptionsFilters, subscriptionsCallback);
};

EatDish.prototype.fetchDish = function(id, callback) {

    DishModel.findById(id).populate('loc').populate('user').exec(function(error, dish) {
        if (error) {
            return callback(error);
        }

        if (!dish) {
            return this.eat.returnCallback({
                code : 404,
                message : 'Not found'
            });
        }

        return callback(null, dish);
    }.bind(this));
};

EatDish.prototype.getById = function() {

    var id = this.eat.getParam('id', this.attrs.id.validation);

    // Specific query as we need to populate location and chef.
    this.fetchDish(id, function(error, dish) {
        if (error) {
            return this.eat.returnCallback(error);
        }
        this.getDishExtraData(dish);

    }.bind(this));
};

EatDish.prototype.add = function() {

    var dish = {};
    dish = this.fillDish(dish);

    // Add the location.
    dish.loc = this.eat.getParam(
        'locationid',
        this.attrs.locationid.validation
    );

    // Set the user.
    dish.user = this.eat.getUserid();

    var dishInstance = new DishModel(dish);

    // Here we check that the user can add to that location.
    var accessCheckedCallback = function(error, subscriptions) {
        if (error) {
            return this.eat.returnCallback(error);
        }

        if (subscriptions.length === false) {
            return this.eat.returnCallback({
                code : 400,
                message : 'Not subscribed to this location'
            });
        }

        var hasAccess = false;
        subscriptions.forEach(function(subscription) {
            if (subscription._id.equals(dish.loc._id)) {
                hasAccess = true;
            }
        });

        // Save the dish.
        this.save(dishInstance, 201, savedCallback);

    }.bind(this);

    // Here we will proceed to save the dish.
    var savedCallback = function(error, dish) {
        if (error) {
            return this.eat.returnCallback(error);
        }

        this.countUserDishes(dish, notificationsCallback);

    }.bind(this);

    // Here we will send the notifications to the subscribers.
    var notificationsCallback = function(error, dish) {
        if (error) {
            return this.eat.returnCallback(error);
        }

        this.sendNotifications(dish);

    }.bind(this);

    this.eat.getEatLocationSubscription().fetch({userid : this.eat.getUserid()}, accessCheckedCallback);
};

EatDish.prototype.update = function() {

    var id = this.eat.getParam(
        'id',
        this.attrs.id.validation,
        this.attrs.id.pattern
    );

    // We also check that the user is the dish chef.
    var filters = {_id : id, user : this.eat.getUserid()};

    // Here we will update the dish data.
    var dishCallback = function(error, dishes) {
        if (error) {
            return this.eat.returnCallback(error);
        }

        if (dishes.length === 0) {
            return this.eat.returnCallback({
                code : 400,
                message : 'Unexisting dish'
            });
        }

        // Get the existing data.
        var dish = dishes[0];

        // Overwrite only a few values.
        dish = this.fillDish(dish);

        this.save(dish, 200);

    }.bind(this);

    this.fetch(filters, dishCallback);
};

EatDish.prototype.fetch = function(filters, callback) {
    if (typeof callback === 'undefined') {
        callback = this.eat.returnCallback.bind(this.eat);
    }

    // When getting dishes we force the order by time created.
    var extra = {sort : {'created' : -1}};
    DishModel.find(filters, {}, extra, function(error, dishes) {
        if (error) {
            return callback(error);
        }

        return callback(null, dishes);
    }.bind(this));
};

EatDish.prototype.save = function(dish, successStatusCode, callback) {
    if (typeof callback === 'undefined') {
        callback = this.eat.returnCallback.bind(this.eat);
    }

    dish.save(function(error) {
        if (error) {
            return callback(error);
        }

        // Now save the photo if there is one.
        var photo = this.eat.getParam(
            'photo',
            this.attrs.photo.validation
        );

        // We will save the photo in background.
        if (this.eat.hasValue(photo)) {
            this.savePhoto(photo, dish);
        }

        // In case the value exists (previous value or savePhoto()
        // already finished), it is too big to be returned now.
        delete dish.photoid;

        // Here we have all data and we return it.
        var doneCallback = function(error, dish) {
            if (error) {
                return this.eat.returnCallback(error);
            }
            return callback(null, dish, successStatusCode);
        }.bind(this);

        // We get both location and chef.
        this.fetchDish(dish._id, doneCallback);

    }.bind(this));
};

EatDish.prototype.getDishExtraData = function(dish) {

    // Here we will get the number of booked meals and the photo.
    var bookedMealsCallback = function(error, bookedmeals) {
        if (error) {
            return this.eat.returnCallback(error);
        }

        // We want to add extra fields and we can not do it in a model.
        dish = dish.toJSON();

        // Has the current user booked this dish?
        dish.booked = false;
        bookedmeals.forEach(function(meal) {
            if (meal.userid.equals(this.eat.getUserid())) {
                dish.booked = true;
                return;
            }
        }.bind(this));

        // Frontend will count the remaining portions.
        dish.nbookedmeals = bookedmeals.length;

        // We need to get the photo data if there is any.
        if (!this.eat.hasValue(dish.photoid)) {

            // We just check the access and return the dish.
            return this.checkUserAccess(dish);

        } else {
            PhotoModel.findById(dish.photoid, function(error, photo) {
                if (error) {
                    return this.eat.returnCallback(error);
                }
                dish.photo = "data:image/jpeg;base64," + photo.data;

                // Check the access and return the dish.
                return this.checkUserAccess(dish);
            }.bind(this));
        }
    }.bind(this);

    // Get the dish meals and after that the photo if there is one.
    this.eat.getEatMeal().fetch({dishid : dish.id}, bookedMealsCallback);
};

EatDish.prototype.countUserDishes = function(dish, callback) {
    if (typeof callback === 'undefined') {
        callback = this.eat.returnCallback.bind(this.eat);
    }

    // We save the user and later we notify subscribers.
    DishModel.count({user : this.eat.getUserid()}, function(error, count) {
        if (error) {
            return callback(error);
        }

        // We want to add extra fields and we can not do it in a model.
        dish = dish.toJSON();

        dish.dishescount = count;
        return callback(null, dish);
    }.bind(this));
};

EatDish.prototype.sendNotifications = function(dish) {

    // Here dish.loc is the locationid, not an object.
    this.eat.getEatLocationSubscription().fetch({locationid : dish.loc}, function(error, subscriptions) {

        // Everything is done so we should return the dish, but
        // log the problem getting the location members.
        if (error) {
            return this.eat.returnCallback(null, dish, 201);
        }

        if (subscriptions.length === 0) {
            dish.nsubscribers = 0;
            return this.returnDish(dish, 201);
        }

        // Here we also include the chef.
        var subscriptionsIds = [];
        subscriptions.forEach(function(subscription) {
            subscriptionsIds.push(subscription.userid);
        });

        var filters = { _id : { $in : subscriptionsIds }};
        this.eat.getEatUser().fetch(filters, function(error, users) {
            if (error) {
                dish.nsubscribers = 0;
                return this.eat.returnCallback(null, dish, 201);
            }

            var gcmregids = [];
            var currentUser = null;
            users.forEach(function(user) {

                if (user._id.equals(this.eat.getUserid())) {
                    currentUser = user;
                }
                gcmregids.push(user.gcmregid);
            }.bind(this));

            // TODO This message should be language-independent, frontend
            // should get the string according to the params we will send from here.
            var msgdata = {
                "message": "Chef " + currentUser.name + " added a new dish! " + dish.name,
                "type": "dish",
                "dishid": dish.id
            };

            // GCM notifications.
            if (gcmregids.length > 0) {
                var pusher = require('../lib/pusher.js');
                pusher.pushToGCM(gcmregids, msgdata);
            }

            // TODO Email fallback for users without any GCM reg id nor iPhone.

            // All good, so we notify and finish.
            dish.nsubscribers = users.length;
            return this.returnDish(dish, 201);

        }.bind(this));
    }.bind(this));
};

/**
 * Saves the photo in background.
 *
 * We just store the data and save the reference on the dish.
 *
 * Here we can just log an error as we can not return
 * any error.
 */
EatDish.prototype.savePhoto = function(photoData, dish) {

    var photo = new PhotoModel({ data : photoData });
    photo.save(function(error) {
        if (error) {
            console.log('Error storing ' + dish._id + ' dish photo. Error: ' + error
            );
        } else {

            // Update the dish with a reference to the photo.
            dish.photoid = photo._id;
            dish.save(function(error) {
                if (error) {
                    console.log(
                        dish._id + 'dish photo can not be stored: ' + error
                    );
                }
            }.bind(this));
        }
    }.bind(this));
};

EatDish.prototype.checkUserAccess = function(dish, callback) {

    // If no callback just finish.
    if (typeof callback === 'undefined') {
        callback = this.eat.returnCallback.bind(this.eat);
    }

    var userAccessCallback = function(error, subscriptions) {
        if (error) {
            return callback(error);
        }

        var hasAccess = false;
        subscriptions.forEach(function(subscription) {
            if (dish.loc._id.equals(subscription.locationid)) {
                hasAccess = true;
            }
        });

        if (hasAccess === false) {
            return callback({
                code : 401,
                message : 'No access'
            });
        }

        callback(null, dish);

    }.bind(this);

    this.eat.getEatLocationSubscription().fetch({userid : this.eat.getUserid()}, userAccessCallback);
};

EatDish.prototype.fillDish = function(dish) {

    dish.name = this.eat.getParam(
        'name',
        this.attrs.name.validation,
        this.attrs.name.pattern
    );
    dish.description = this.eat.getParam(
        'name',
        this.attrs.description.validation,
        this.attrs.description.pattern
    );
    dish.when = this.eat.getParam(
        'when',
        this.attrs.when.validation
    );
    dish.nportions = this.eat.getParam(
        'nportions',
        this.attrs.nportions.validation
    );
    dish.donation = this.eat.getParam(
        'donation',
        this.attrs.donation.validation
    );

    return dish;
};

/**
 * @private
 */
EatDish.prototype.returnDish = function(dish, returnCode) {
    // Keeping a separate function for the transition.
    return this.eat.returnCallback(null, dish, returnCode);
};

module.exports = EatDish;