# Open the running dashboard

For a host deployment, use the private address configured as `OPSDECK_BIND` and the configured port (default 8080). Open that URL in a browser on the node or on a device connected to the same private network, such as Tailscale.

The app uses the operator token in the node's private `.env`. Retrieve it in your own terminal, using your deployment account:

```bash
ssh <user>@<private-node-address> "sed -n 's/^OPSDECK_TOKEN *= *//p' ~/opsdeck/.env"
```

Enter it in the dashboard's **Access token** field. This is an application token; no GitHub or GitLab account is required to open the dashboard.

## SSH tunnel

If the browser cannot reach the private node address directly, forward a local port to the actual address on which OpsDeck listens:

```bash
ssh -N -L 18080:<opsdeck-bind-address>:8080 <user>@<ssh-node-address>
```

Keep this terminal open, then visit `http://127.0.0.1:18080`. For a service bound only to localhost on the node, use `127.0.0.1` as the bind address in the tunnel.

## Check the workstation

- **Overview:** live capacity, alerts, service coverage, and a link to the speedup report.
- **Survey & benchmarks:** choose before/after runs, inspect speedup ratios and saved time, check queue effects and regressions, read supplementary measurements versus projections, and download a report.
- **Runner stack:** active CI containers, retained worker observations, local image tags, and cache/storage placement.
- **Optimization:** recorded changes and independently verified current host checks.
- **Activity & audit:** retained alerts and operator actions.
- **Connections:** freshness, collection method, and unavailable providers.

On the node, run `cd ~/opsdeck && make docker-status` for container state, `make docker-logs` for app diagnostics, and `make docker-backup` for a consistent database backup. Survey evidence is historical; Docker activity is live. New pipeline outcomes require additional result records or the optional GitLab integration.
