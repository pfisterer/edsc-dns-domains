#!/bin/sh

NAMED_BINARY="/usr/sbin/named"
NAMED_CHECK_CONF_BINARY="/usr/sbin/named-checkconf"
NAMED_CONFIG_DIR="/etc/bind"
NAMED_VAR_DIR="/var/bind/gen"
NAMED_CONFIG_FILE="$NAMED_CONFIG_DIR/named.conf"
# -g: Run the server in the foreground and force all logging to stderr.
NAMED_OPTS="-g -u named -c $NAMED_CONFIG_FILE"
NAMED_GROUP="named"

RESTART_REQUEST_FILE=/etc/bind/bind-restart.requested
RESTART_NOTIFICATION_FILE=/etc/bind/bind-restart.done
CHECK_INTERVAL="10s"

CMD="$NAMED_BINARY $NAMED_OPTS"

show_banner () {
	echo "ENTRYPOINT: $1"
} 

fix_fs_permissions() {
	chown -R "root:$NAMED_GROUP" "$NAMED_CONFIG_DIR"
	chmod -R ug+r "$NAMED_CONFIG_DIR"
}

wait_for_config_wo_errors() {

	# Wait until bind config file exists
	while [[ ! -f "$NAMED_CONFIG_FILE"	]]; do
		show_banner "Waiting for $NAMED_CONFIG_FILE to exist, next check in $CHECK_INTERVAL"
		sleep "$CHECK_INTERVAL"
	done

	# Check configuration for errors
	while /bin/true; do 
		TMP_CMD="$NAMED_CHECK_CONF_BINARY -z -j -c $NAMED_CONFIG_FILE"
		show_banner "Checking $NAMED_CONFIG_FILE for errors (running $TMP_CMD)" 
		$TMP_CMD
		EXIT_STATUS=$?

		if [[ $EXIT_STATUS -eq 0 ]]; then 
			show_banner "Config is ok" 
			break; 
		fi

		# Configuration is invalid, try to resolve "journal out of sync with zone" errors
		COUNT=$($TMP_CMD | grep 'journal out of sync with zone' | wc -l)
		if [[ $COUNT -gt 0 ]]; then
			show_banner "$COUNT journal files are out of sync with zone, delete all journal files"
			find "$NAMED_VAR_DIR" -type f -name '*.jnl' -print -delete
			break;
		fi

		show_banner "Errors found in $NAMED_CONFIG_FILE, next check in $CHECK_INTERVAL" 
		sleep "$CHECK_INTERVAL"
	done

}

while /bin/true; do 
	# Set correct access rights on config folder
	fix_fs_permissions

	# Wait for valid config
	wait_for_config_wo_errors

	# Start bind
	show_banner "Starting process (running: $CMD)"
	$CMD &
	PROC_ID=$!
	show_banner "Process pid is $PROC_ID"
	
	sleep "$CHECK_INTERVAL"

	# Check if the process is running
	while kill -0 "$PROC_ID" >/dev/null 2>&1; do
		# show_banner "Bind is running (process id $PROC_ID)"

		# Check whether a restart of bind was requested
		if [[ -f "$RESTART_REQUEST_FILE" ]]; then
			# Wait for valid config
			show_banner "Restart requested (file $RESTART_REQUEST_FILE present), checking config first"			
			fix_fs_permissions
			wait_for_config_wo_errors
		
			# Send SIGHUP to bind
			show_banner "Config ok, sending SIGHUP to $PROC_ID"			
			kill -HUP "$PROC_ID"

			# Delete the update request file
			rm -f "$RESTART_REQUEST_FILE" 

			# Notify about restart by touching a file
			show_banner "Restart done (touching file  $RESTART_NOTIFICATION_FILE)"
			touch "$RESTART_NOTIFICATION_FILE"
		fi

		sleep "$CHECK_INTERVAL"
	done

	# Bind has terminated (e.g., due to a faulty config)
	show_banner "Process has terminated"
done
