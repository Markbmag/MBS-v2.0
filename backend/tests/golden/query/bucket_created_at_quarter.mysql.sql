SELECT date_add(makedate(year(q_orders.created_at), 1), INTERVAL quarter(q_orders.created_at) - 1 QUARTER) AS period, count(*) AS n 
FROM q_orders GROUP BY date_add(makedate(year(q_orders.created_at), 1), INTERVAL quarter(q_orders.created_at) - 1 QUARTER) ORDER BY `period` ASC 
 LIMIT 2000
