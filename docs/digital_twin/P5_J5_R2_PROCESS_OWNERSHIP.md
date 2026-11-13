# P5-J5-R2 process ownership

A stale P5-J5 preview / Chrome child tree prevented isolated Playwright
reruns. A normal termination was attempted; the host rejected forced tree
termination because the ownership of every descendant could not be proved.

No unknown Node, Chrome, Gazebo, SITL, or Gateway process was terminated.
Before retrying browser tests, obtain a clean user-controlled browser boundary
or an ownership-capable runner that records PID, parent PID, start time,
command line, working directory, listener port, and final exit result for all
children.
