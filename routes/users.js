var User = require('../models/user');
var Task = require('../models/task');
var mongoose = require('mongoose');

module.exports = function (router) {

    var usersRoute = router.route('/users');

    // GET /api/users - list users with query params
    usersRoute.get(function (req, res) {
        var query = User.find();

        try {
            if (req.query.where) query.where(JSON.parse(req.query.where));
            if (req.query.sort) query.sort(JSON.parse(req.query.sort));
            if (req.query.select) query.select(JSON.parse(req.query.select));
            if (req.query.skip) query.skip(Number(req.query.skip));
            if (req.query.limit) query.limit(Number(req.query.limit));
        } catch (err) {
            return res.status(400).json({ message: 'Invalid query parameter', data: {} });
        }

        if (req.query.count === 'true') {
            var countQuery = User.countDocuments();
            try {
                if (req.query.where) countQuery.where(JSON.parse(req.query.where));
            } catch (err) {
                return res.status(400).json({ message: 'Invalid query parameter', data: {} });
            }
            countQuery.then(function (count) {
                return res.status(200).json({ message: 'OK', data: count });
            }).catch(function (err) {
                return res.status(500).json({ message: 'Server error', data: {} });
            });
        } else {
            query.then(function (users) {
                return res.status(200).json({ message: 'OK', data: users });
            }).catch(function (err) {
                return res.status(500).json({ message: 'Server error', data: {} });
            });
        }
    });

    // POST /api/users - create a new user
    usersRoute.post(function (req, res) {
        if (!req.body.name || !req.body.email) {
            return res.status(400).json({ message: 'Name and email are required', data: {} });
        }

        var pendingTasks = req.body.pendingTasks || [];

        // Validate task id format
        for (var i = 0; i < pendingTasks.length; i++) {
            if (!mongoose.Types.ObjectId.isValid(pendingTasks[i])) {
                return res.status(400).json({ message: 'Invalid task id in pendingTasks', data: {} });
            }
        }

        // Check email uniqueness
        User.findOne({ email: req.body.email }).then(function (existingUser) {
            if (existingUser) {
                return res.status(400).json({ message: 'Email already exists', data: {} });
            }

            if (pendingTasks.length === 0) {
                return createUser();
            }

            // Verify all tasks exist and are not completed
            return Task.find({ _id: { $in: pendingTasks } }).then(function (tasks) {
                if (tasks.length !== pendingTasks.length) {
                    return res.status(404).json({ message: 'One or more tasks not found', data: {} });
                }
                for (var i = 0; i < tasks.length; i++) {
                    if (tasks[i].completed) {
                        return res.status(400).json({ message: 'Cannot add completed task to pendingTasks', data: {} });
                    }
                }
                return createUser();
            });

            function createUser() {
                var user = new User({
                    name: req.body.name,
                    email: req.body.email,
                    pendingTasks: pendingTasks
                });

                return user.save().then(function (savedUser) {
                    // Sync: assign these tasks to the new user
                    var updates = pendingTasks.map(function (taskId) {
                        return Task.findById(taskId).then(function (task) {
                            var oldUserId = task.assignedUser;
                            task.assignedUser = savedUser._id.toString();
                            task.assignedUserName = savedUser.name;
                            var p = task.save();
                            // If the task was assigned to another user, remove it from that user's pendingTasks
                            if (oldUserId && oldUserId !== '') {
                                p = p.then(function () {
                                    return User.findByIdAndUpdate(oldUserId, {
                                        $pull: { pendingTasks: taskId }
                                    });
                                });
                            }
                            return p;
                        });
                    });
                    return Promise.all(updates).then(function () {
                        return res.status(201).json({ message: 'User created', data: savedUser });
                    });
                });
            }
        }).catch(function (err) {
            return res.status(500).json({ message: 'Server error', data: {} });
        });
    });

    var userIdRoute = router.route('/users/:id');

    // GET /api/users/:id - get a single user
    userIdRoute.get(function (req, res) {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({ message: 'User not found', data: {} });
        }

        var query = User.findById(req.params.id);
        try {
            if (req.query.select) query.select(JSON.parse(req.query.select));
        } catch (err) {
            return res.status(400).json({ message: 'Invalid select parameter', data: {} });
        }

        query.then(function (user) {
            if (!user) {
                return res.status(404).json({ message: 'User not found', data: {} });
            }
            return res.status(200).json({ message: 'OK', data: user });
        }).catch(function (err) {
            return res.status(500).json({ message: 'Server error', data: {} });
        });
    });

    // PUT /api/users/:id - replace a user
    userIdRoute.put(function (req, res) {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({ message: 'User not found', data: {} });
        }

        if (!req.body.name || !req.body.email) {
            return res.status(400).json({ message: 'Name and email are required', data: {} });
        }

        var newPendingTasks = req.body.pendingTasks || [];

        // Validate task id format
        for (var i = 0; i < newPendingTasks.length; i++) {
            if (!mongoose.Types.ObjectId.isValid(newPendingTasks[i])) {
                return res.status(400).json({ message: 'Invalid task id in pendingTasks', data: {} });
            }
        }

        User.findById(req.params.id).then(function (user) {
            if (!user) {
                return res.status(404).json({ message: 'User not found', data: {} });
            }

            // Check email uniqueness (exclude self)
            return User.findOne({ email: req.body.email, _id: { $ne: user._id } }).then(function (dup) {
                if (dup) {
                    return res.status(400).json({ message: 'Email already exists', data: {} });
                }

                if (newPendingTasks.length > 0) {
                    return Task.find({ _id: { $in: newPendingTasks } }).then(function (tasks) {
                        if (tasks.length !== newPendingTasks.length) {
                            return res.status(404).json({ message: 'One or more tasks not found', data: {} });
                        }
                        for (var i = 0; i < tasks.length; i++) {
                            if (tasks[i].completed) {
                                return res.status(400).json({ message: 'Cannot add completed task to pendingTasks', data: {} });
                            }
                        }
                        return doUpdate(user);
                    });
                }
                return doUpdate(user);
            });
        }).catch(function (err) {
            return res.status(500).json({ message: 'Server error', data: {} });
        });

        function doUpdate(user) {
            var oldPendingTasks = user.pendingTasks.slice();
            var userId = user._id.toString();
            var oldName = user.name;

            user.name = req.body.name;
            user.email = req.body.email;
            user.pendingTasks = newPendingTasks;

            return user.save().then(function (savedUser) {
                var promises = [];

                // Tasks in old but not in new → unassign
                oldPendingTasks.forEach(function (taskId) {
                    if (newPendingTasks.indexOf(taskId) === -1) {
                        promises.push(
                            Task.findById(taskId).then(function (task) {
                                if (task && task.assignedUser === userId) {
                                    task.assignedUser = '';
                                    task.assignedUserName = 'unassigned';
                                    return task.save();
                                }
                            })
                        );
                    }
                });

                // Tasks in new but not in old → assign to this user
                newPendingTasks.forEach(function (taskId) {
                    if (oldPendingTasks.indexOf(taskId) === -1) {
                        promises.push(
                            Task.findById(taskId).then(function (task) {
                                if (task) {
                                    var oldAssignedUser = task.assignedUser;
                                    task.assignedUser = userId;
                                    task.assignedUserName = savedUser.name;
                                    var p = task.save();
                                    // Remove from previous user's pendingTasks if reassigned
                                    if (oldAssignedUser && oldAssignedUser !== '' && oldAssignedUser !== userId) {
                                        p = p.then(function () {
                                            return User.findByIdAndUpdate(oldAssignedUser, {
                                                $pull: { pendingTasks: taskId }
                                            });
                                        });
                                    }
                                    return p;
                                }
                            })
                        );
                    }
                });

                // If name changed, update assignedUserName on all tasks assigned to this user
                if (savedUser.name !== oldName) {
                    promises.push(
                        Task.updateMany(
                            { assignedUser: userId },
                            { assignedUserName: savedUser.name }
                        )
                    );
                }

                return Promise.all(promises).then(function () {
                    return res.status(200).json({ message: 'User updated', data: savedUser });
                });
            });
        }
    });

    // DELETE /api/users/:id - delete a user
    userIdRoute.delete(function (req, res) {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({ message: 'User not found', data: {} });
        }

        User.findByIdAndDelete(req.params.id).then(function (user) {
            if (!user) {
                return res.status(404).json({ message: 'User not found', data: {} });
            }
            // Unassign all tasks belonging to this user (including completed ones)
            return Task.updateMany(
                { assignedUser: user._id.toString() },
                { assignedUser: '', assignedUserName: 'unassigned' }
            ).then(function () {
                return res.status(200).json({ message: 'User deleted', data: user });
            });
        }).catch(function (err) {
            return res.status(500).json({ message: 'Server error', data: {} });
        });
    });

    return router;
};
