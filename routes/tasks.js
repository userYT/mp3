var Task = require('../models/task');
var User = require('../models/user');
var mongoose = require('mongoose');

module.exports = function (router) {

    var tasksRoute = router.route('/tasks');

    // GET /api/tasks - list tasks with query params (default limit 100)
    tasksRoute.get(function (req, res) {
        var query = Task.find();

        try {
            if (req.query.where) query.where(JSON.parse(req.query.where));
            if (req.query.sort) query.sort(JSON.parse(req.query.sort));
            if (req.query.select) query.select(JSON.parse(req.query.select));
            if (req.query.skip) query.skip(Number(req.query.skip));
            query.limit(req.query.limit ? Number(req.query.limit) : 100);
        } catch (err) {
            return res.status(400).json({ message: 'Invalid query parameter', data: {} });
        }

        if (req.query.count === 'true') {
            var countQuery = Task.countDocuments();
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
            query.then(function (tasks) {
                return res.status(200).json({ message: 'OK', data: tasks });
            }).catch(function (err) {
                return res.status(500).json({ message: 'Server error', data: {} });
            });
        }
    });

    // POST /api/tasks - create a new task
    tasksRoute.post(function (req, res) {
        if (!req.body.name || !req.body.deadline) {
            return res.status(400).json({ message: 'Name and deadline are required', data: {} });
        }

        var assignedUser = req.body.assignedUser || '';
        var assignedUserName = req.body.assignedUserName || 'unassigned';

        // Validate assignedUser id format
        if (assignedUser !== '' && !mongoose.Types.ObjectId.isValid(assignedUser)) {
            return res.status(400).json({ message: 'Invalid assignedUser id', data: {} });
        }

        var proceed = Promise.resolve();

        if (assignedUser !== '') {
            proceed = User.findById(assignedUser).then(function (user) {
                if (!user) {
                    return Promise.reject({ status: 404, message: 'Assigned user not found' });
                }
                // Validate assignedUserName matches user's name (if provided)
                if (req.body.assignedUserName && req.body.assignedUserName !== user.name) {
                    return Promise.reject({ status: 400, message: 'assignedUserName does not match the user' });
                }
                assignedUserName = user.name;
            });
        }

        proceed.then(function () {
            var task = new Task({
                name: req.body.name,
                description: req.body.description || '',
                deadline: req.body.deadline,
                completed: req.body.completed || false,
                assignedUser: assignedUser,
                assignedUserName: assignedUserName
            });

            return task.save().then(function (savedTask) {
                // If assigned and not completed, add to user's pendingTasks
                if (assignedUser !== '' && !savedTask.completed) {
                    return User.findByIdAndUpdate(assignedUser, {
                        $addToSet: { pendingTasks: savedTask._id.toString() }
                    }).then(function () {
                        return res.status(201).json({ message: 'Task created', data: savedTask });
                    });
                }
                return res.status(201).json({ message: 'Task created', data: savedTask });
            });
        }).catch(function (err) {
            if (err.status) {
                return res.status(err.status).json({ message: err.message, data: {} });
            }
            return res.status(500).json({ message: 'Server error', data: {} });
        });
    });

    var taskIdRoute = router.route('/tasks/:id');

    // GET /api/tasks/:id - get a single task
    taskIdRoute.get(function (req, res) {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({ message: 'Task not found', data: {} });
        }

        var query = Task.findById(req.params.id);
        try {
            if (req.query.select) query.select(JSON.parse(req.query.select));
        } catch (err) {
            return res.status(400).json({ message: 'Invalid select parameter', data: {} });
        }

        query.then(function (task) {
            if (!task) {
                return res.status(404).json({ message: 'Task not found', data: {} });
            }
            return res.status(200).json({ message: 'OK', data: task });
        }).catch(function (err) {
            return res.status(500).json({ message: 'Server error', data: {} });
        });
    });

    // PUT /api/tasks/:id - replace a task
    taskIdRoute.put(function (req, res) {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({ message: 'Task not found', data: {} });
        }

        if (!req.body.name || !req.body.deadline) {
            return res.status(400).json({ message: 'Name and deadline are required', data: {} });
        }

        var newAssignedUser = req.body.assignedUser || '';
        var newAssignedUserName = req.body.assignedUserName || 'unassigned';
        var newCompleted = req.body.completed || false;

        // Validate assignedUser id format
        if (newAssignedUser !== '' && !mongoose.Types.ObjectId.isValid(newAssignedUser)) {
            return res.status(400).json({ message: 'Invalid assignedUser id', data: {} });
        }

        Task.findById(req.params.id).then(function (task) {
            if (!task) {
                return res.status(404).json({ message: 'Task not found', data: {} });
            }

            var validateUser = Promise.resolve();

            if (newAssignedUser !== '') {
                validateUser = User.findById(newAssignedUser).then(function (user) {
                    if (!user) {
                        return Promise.reject({ status: 404, message: 'Assigned user not found' });
                    }
                    if (req.body.assignedUserName && req.body.assignedUserName !== user.name) {
                        return Promise.reject({ status: 400, message: 'assignedUserName does not match the user' });
                    }
                    newAssignedUserName = user.name;
                });
            }

            return validateUser.then(function () {
                var oldAssignedUser = task.assignedUser;
                var oldCompleted = task.completed;

                // Update task fields (replace entire task, keep dateCreated)
                task.name = req.body.name;
                task.description = req.body.description || '';
                task.deadline = req.body.deadline;
                task.completed = newCompleted;
                task.assignedUser = newAssignedUser;
                task.assignedUserName = newAssignedUser === '' ? 'unassigned' : newAssignedUserName;

                return task.save().then(function (savedTask) {
                    var promises = [];
                    var taskId = savedTask._id.toString();

                    // Remove from old user's pendingTasks if user changed
                    if (oldAssignedUser && oldAssignedUser !== '' && oldAssignedUser !== newAssignedUser) {
                        promises.push(
                            User.findByIdAndUpdate(oldAssignedUser, {
                                $pull: { pendingTasks: taskId }
                            })
                        );
                    }

                    if (newAssignedUser !== '') {
                        if (!newCompleted) {
                            // Task is pending → add to new user's pendingTasks
                            promises.push(
                                User.findByIdAndUpdate(newAssignedUser, {
                                    $addToSet: { pendingTasks: taskId }
                                })
                            );
                        } else {
                            // Task is completed → remove from user's pendingTasks
                            promises.push(
                                User.findByIdAndUpdate(newAssignedUser, {
                                    $pull: { pendingTasks: taskId }
                                })
                            );
                        }
                    }

                    return Promise.all(promises).then(function () {
                        return res.status(200).json({ message: 'Task updated', data: savedTask });
                    });
                });
            });
        }).catch(function (err) {
            if (err.status) {
                return res.status(err.status).json({ message: err.message, data: {} });
            }
            return res.status(500).json({ message: 'Server error', data: {} });
        });
    });

    // DELETE /api/tasks/:id - delete a task
    taskIdRoute.delete(function (req, res) {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({ message: 'Task not found', data: {} });
        }

        Task.findByIdAndDelete(req.params.id).then(function (task) {
            if (!task) {
                return res.status(404).json({ message: 'Task not found', data: {} });
            }
            // Remove from assigned user's pendingTasks
            if (task.assignedUser && task.assignedUser !== '') {
                return User.findByIdAndUpdate(task.assignedUser, {
                    $pull: { pendingTasks: task._id.toString() }
                }).then(function () {
                    return res.status(204).send();
                });
            }
            return res.status(204).send();
        }).catch(function (err) {
            return res.status(500).json({ message: 'Server error', data: {} });
        });
    });

    return router;
};
